// parse-ig-workout — RVN OS Edge Function
// Handles two modes:
//   mode="workout" → extracts exercises, sets, reps from a post
//   mode="food"    → extracts ingredients + estimates macros (calories, protein, carbs, fat)
//
// Required Supabase secret:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// POST body:
//   { url?: string, caption?: string, mode?: "workout" | "food" }
//   mode defaults to "workout"
//
// Cost: Claude Haiku is ~$0.001 per 1,000 requests — negligible.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Fetch caption / description from any public post URL ─────────────────────
async function fetchPageText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Try og:description first (Instagram captions, recipe site summaries)
    const desc =
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1] ||
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i)?.[1];

    // Fall back to og:title
    const title =
      html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)?.[1] ||
      html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];

    // For recipe sites, also try to grab the main article text (first 2000 chars)
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);

    const combined = [title, desc].filter(Boolean).join(" — ").trim();

    if (combined.length > 20) return combined;
    if (bodyText.length > 100) return bodyText;
    return null;
  } catch {
    return null;
  }
}

// ── Parse workout exercises ───────────────────────────────────────────────────
async function parseWorkout(text: string, apiKey: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Extract all workout exercises from this text.

Return ONLY this exact JSON — no markdown, no explanation:
{
  "title": "short workout name or null",
  "exercises": [
    { "name": "Exercise Name", "sets": 3, "reps": "10-12", "weight": null, "notes": null }
  ]
}

Rules:
- sets = number (default 3)
- reps = string like "10", "8-12", "AMRAP", "30 sec"
- weight = string like "135 lbs" or null
- notes = coaching cue or null
- If no exercises found: { "title": null, "exercises": [] }

Text:
${text}`,
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "{}";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const p = m ? JSON.parse(m[0]) : { title: null, exercises: [] };
    return { title: p.title ?? null, exercises: Array.isArray(p.exercises) ? p.exercises : [] };
  } catch {
    return { title: null, exercises: [] };
  }
}

// ── Parse food / macro info ───────────────────────────────────────────────────
async function parseFood(text: string, apiKey: string) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `Analyze this recipe or food post and estimate nutrition info per serving.

Return ONLY this exact JSON — no markdown, no explanation:
{
  "name": "dish name",
  "servings": 1,
  "calories": 450,
  "protein": 35,
  "carbs": 40,
  "fat": 12,
  "fiber": 4,
  "ingredients": [
    { "item": "chicken breast", "amount": "200g" }
  ],
  "notes": "high protein meal, good post-workout" or null
}

Rules:
- All macros are per serving, in grams (except calories)
- Estimate based on the ingredients and amounts mentioned
- If amounts aren't specified, use typical serving sizes
- If this isn't food content: { "name": null, "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "fiber": 0, "ingredients": [], "notes": null }

Text:
${text}`,
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}`);
  const data = await res.json();
  const raw = data.content?.[0]?.text ?? "{}";
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { name: null, calories: 0, protein: 0, carbs: 0, fat: 0 };
  } catch {
    return { name: null, calories: 0, protein: 0, carbs: 0, fat: 0 };
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { url, caption, mode = "workout" } = (await req.json()) as {
      url?: string;
      caption?: string;
      mode?: "workout" | "food";
    };

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return json({ success: false, error: "ANTHROPIC_API_KEY not configured." }, 500);

    let text = caption?.trim() ?? "";

    // If no caption, try to fetch the page
    if (!text && url) {
      const fetched = await fetchPageText(url);
      if (fetched) {
        text = fetched;
      } else {
        return json({
          success: false,
          needsCaption: true,
          error: "Couldn't read the post automatically. Paste the caption or ingredients below.",
        });
      }
    }

    if (!text) return json({ success: false, needsCaption: true, error: "No content to parse." });

    if (mode === "food") {
      const result = await parseFood(text, apiKey);
      const hasData = result.calories > 0 || result.protein > 0;
      return json({ success: true, mode: "food", ...result, needsCaption: !hasData, raw: text });
    } else {
      const { title, exercises } = await parseWorkout(text, apiKey);
      return json({
        success: true, mode: "workout",
        title, exercises, raw: text,
        needsCaption: exercises.length === 0,
      });
    }
  } catch (err) {
    console.error("[parse-ig-workout]", err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
