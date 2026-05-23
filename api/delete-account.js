// Vercel Serverless Function — Account deletion endpoint
// Permanently deletes the caller's Supabase auth user and their profile row.
//
// Apple Guideline 5.1.1(v): apps that support account creation must let users
// initiate full account deletion from within the app. The in-app button calls
// this endpoint so deletion is complete (not just a sign-out / data wipe).
//
// Setup:
//   Vercel dashboard → Settings → Environment Variables, add:
//     SUPABASE_URL               = https://pstqlqiitylggqchkzyh.supabase.co
//     SUPABASE_SERVICE_ROLE_KEY  = <service_role secret from Supabase → Settings → API>
//   Deploy — auto-registers as /api/delete-account
//
// Security: the service-role key is NEVER shipped to the browser. The caller
// must present their own access token; we verify it server-side and only ever
// delete the user identified by that token — never an arbitrary user.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://pstqlqiitylggqchkzyh.supabase.co";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // CORS (same-origin in production; permissive for safety during review)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!SERVICE_ROLE) {
    return res.status(500).json({ error: "Server not configured for account deletion." });
  }

  // The browser sends the user's access token: Authorization: Bearer <token>
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing access token." });

  // Admin client (service role) — server-side only.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // 1. Verify the token and resolve WHO is asking. We only delete this user.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    const user = userData.user;
    const userId = user.id;
    const email = (user.email || "").trim().toLowerCase();

    // 2. Delete the profile row (best effort — keyed by email or id depending on schema).
    try {
      if (email) {
        await admin.from("rvn_profiles").delete().eq("email", email);
      }
    } catch (_) { /* table/column may differ; non-fatal */ }
    try {
      await admin.from("rvn_profiles").delete().eq("id", userId);
    } catch (_) { /* non-fatal */ }

    // 3. Permanently delete the auth user (auth.users row).
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) {
      return res.status(500).json({ error: "Could not delete account.", detail: delErr.message });
    }

    return res.status(200).json({ ok: true, deleted: true });
  } catch (e) {
    return res.status(500).json({ error: "Account deletion failed.", detail: String(e?.message || e) });
  }
}
