# RVN OS — AI Import Feature Setup
## Instagram Workout Import + Recipe Scanner

Both features use ONE Supabase Edge Function (`parse-ig-workout`) powered by
Claude Haiku — the cheapest Anthropic model at ~$0.001 per 1,000 requests.
10,000 imports/month = about $1.

---

## STEP 1 — Install Supabase CLI (one time only)

Open PowerShell and run:

```powershell
npm install -g supabase
```

Verify it worked:
```powershell
supabase --version
```

---

## STEP 2 — Log in to Supabase CLI

```powershell
supabase login
```

This opens your browser. Log in with the same account you used to create the project.

---

## STEP 3 — Link to your RVN project

```powershell
cd C:\Users\tanuj\Favorites\Links
supabase link --project-ref pstqlqiitylggqchkzyh
```

It will ask for your database password — enter it (same one from when you set up Supabase).

---

## STEP 4 — Get your Anthropic API key

1. Go to https://console.anthropic.com
2. Sign up / log in
3. Click **API Keys** in the left sidebar
4. Click **Create Key**
5. Name it "rvn-os" and copy the key (starts with `sk-ant-...`)

> **Cost note:** Claude Haiku costs $0.25 per million input tokens.
> A typical workout/recipe parse is ~300 tokens = $0.000075 each.
> 10,000 imports = $0.75. You won't notice it on your bill.
> Add a $5 credit limit on Anthropic console → Settings → Billing → Spending limits.

---

## STEP 5 — Set the API key as a Supabase secret

```powershell
supabase secrets set ANTHROPIC_API_KEY=sk-ant-YOUR_KEY_HERE --project-ref pstqlqiitylggqchkzyh
```

Replace `sk-ant-YOUR_KEY_HERE` with your actual key. This is stored securely — never exposed to users.

---

## STEP 6 — Deploy the Edge Function

```powershell
supabase functions deploy parse-ig-workout --project-ref pstqlqiitylggqchkzyh
```

You should see: `✓ Deployed Function parse-ig-workout`

---

## STEP 7 — Commit and push the app update

```powershell
Remove-Item .git\refs\heads\main.lock -ErrorAction SilentlyContinue
git add rvn-os-v6.jsx supabase/functions/parse-ig-workout/index.ts
git commit -m "feat: AI workout import + recipe macro scanner via edge function"
git push
```

---

## DONE — How it works now

### Workout Import (TRAIN tab → Import from Instagram)
1. User pastes any IG workout post or Reel link
2. Edge function fetches the post caption automatically
3. Claude Haiku reads the caption and extracts: exercise names, sets, reps, coaching cues
4. App shows a pre-filled editable exercise list
5. User taps "SAVE AS TODAY'S WORKOUT"

If Instagram blocks the auto-fetch → user pastes the caption manually → same AI parsing.

### Recipe Scanner (FUEL tab → Recipe Scanner)
1. User pastes any link — Instagram food post, TikTok recipe, AllRecipes, NYT Cooking, etc.
2. Edge function fetches the page and extracts the recipe text
3. Claude Haiku estimates: calories, protein, carbs, fat, fiber per serving
4. User taps "+ Log to Today's Macros" to add it to their daily total

If the link is blocked → user pastes the ingredients list → same AI extraction.

---

## Cost protection checklist

- [x] Using Claude Haiku (cheapest model — 10x cheaper than Sonnet)
- [x] Results are cached in localStorage (same URL = no API call)
- [x] Set a spending limit on Anthropic: https://console.anthropic.com → Settings → Billing
- [x] Supabase free tier includes 500k Edge Function invocations/month (free)
