// Vercel Serverless Function — Kailu AI endpoint
// Proxies to Anthropic Claude API so the API key never ships in the frontend bundle.
//
// Setup:
//   1. Vercel dashboard → Settings → Environment Variables
//   2. Add: ANTHROPIC_API_KEY = sk-ant-...
//   3. Deploy — auto-registers as /api/kailu
//
// Cost: claude-haiku-4-5-20251001 + prompt caching ≈ $0.03 per 1,000 messages

// ─── In-memory rate limiter ────────────────────────────────────────────────────
// Limits each IP to MAX_REQUESTS per WINDOW_MS.
// Note: resets when the serverless function cold-starts, which is fine for abuse
// prevention (persistent rate limiting needs Vercel KV or Redis).
const WINDOW_MS    = 60_000;  // 1 minute
const MAX_REQUESTS = 20;      // requests per IP per minute
const ipMap = new Map();      // ip → { count, resetAt }

function checkRateLimit(ip) {
  const now  = Date.now();
  const entry = ipMap.get(ip);
  if (!entry || now > entry.resetAt) {
    ipMap.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_REQUESTS) return false;
  entry.count++;
  return true;
}

// Clean up old IPs every 5 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipMap) {
    if (now > entry.resetAt) ipMap.delete(ip);
  }
}, 300_000);

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "Method not allowed" });

  // Rate limit by IP
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
           || req.socket?.remoteAddress
           || "unknown";
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: "Too many requests — slow down a bit." });
  }

  const { system, user, history, max_tokens, model: requestedModel, image_base64 } = req.body || {};
  if (!user) return res.status(400).json({ error: "Missing user message" });

  // Model routing: use requested model or default to haiku for cost efficiency
  // Sonnet is reserved for: vision/image, complex protocol questions, workout generation
  const HAIKU   = "claude-haiku-4-5-20251001";
  const SONNET  = "claude-sonnet-4-5";
  const model   = requestedModel === "sonnet" ? SONNET : HAIKU;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });

  // Build messages: prior turns + current user message
  const priorTurns = Array.isArray(history) ? history : [];

  // Build the user content — plain text or multimodal (text + image)
  const userContent = image_base64
    ? [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image_base64 } },
        { type: "text",  text: user },
      ]
    : user;

  const messages = [
    ...priorTurns.map(m => ({
      role:    m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    })),
    { role: "user", content: userContent },
  ];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta":    "prompt-caching-2024-07-31",
      },
      body: JSON.stringify({
        model,
        max_tokens: max_tokens || 280,
        system: [
          {
            type: "text",
            text: system || "You are Kailu, an elite performance AI inside RVN OS. Be concise, direct, and data-driven.",
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("[Kailu] Anthropic error:", err);
      return res.status(502).json({ error: "Upstream API error" });
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || null;
    return res.status(200).json({ text });

  } catch (err) {
    console.error("[Kailu] fetch error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
