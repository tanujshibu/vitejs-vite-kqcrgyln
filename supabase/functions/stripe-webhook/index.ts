// Supabase Edge Function — stripe-webhook
// Listens for Stripe events and keeps rvn_profiles subscription status in sync.
//
// Required Supabase secrets:
//   STRIPE_SECRET_KEY        = sk_live_...
//   STRIPE_WEBHOOK_SECRET    = whsec_... (from Stripe Dashboard → Webhooks → Signing secret)
//   SUPABASE_SERVICE_ROLE_KEY = built-in Supabase secret
//
// Stripe events handled:
//   checkout.session.completed        → subscription created, mark active
//   customer.subscription.updated     → plan change or renewal
//   customer.subscription.deleted     → cancellation, mark canceled
//   invoice.payment_failed            → payment issue, mark past_due

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

// Map Stripe price IDs to our internal tier names.
// These must match the price IDs you create in the Stripe Dashboard.
// The app will read the tier from rvn_profiles.subscription_tier.
const PRICE_TO_TIER: Record<string, string> = {
  // ── Fill in your real Stripe price IDs below ──────────────────────────────
  // Individual
  "price_individual_monthly":    "individual",   // $19/month — REPLACE with real ID
  // Gym tiers
  "price_gym_studio_monthly":    "gym_studio",   // $199/month — REPLACE
  "price_gym_club_monthly":      "gym_club",     // $349/month — REPLACE
  "price_gym_perf_monthly":      "gym_perf",     // $549/month — REPLACE
  "price_gym_ent_monthly":       "gym_ent",      // $899/month — REPLACE
  "price_gym_intro_month":       "gym_intro",    // free trial  — REPLACE
};

Deno.serve(async (req: Request) => {
  const stripeKey     = Deno.env.get("STRIPE_SECRET_KEY")!;
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

  if (!stripeKey || !webhookSecret) {
    console.error("[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET");
    return new Response("Webhook secrets not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

  // Verify Stripe signature — rejects anything not from Stripe
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return new Response(`Webhook signature verification failed: ${err}`, { status: 400 });
  }

  // Supabase admin client — bypasses RLS so we can update any profile
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  console.log(`[stripe-webhook] Processing event: ${event.type}`);

  try {
    switch (event.type) {

      // ── Checkout completed — subscription just created ──────────────────────
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;

        const userId   = session.metadata?.userId     || null;
        const gymId    = session.metadata?.gymId      || null;
        const isGym    = session.metadata?.isGym === "true";
        const custId   = typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subId    = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

        // Retrieve the subscription to get the price ID and trial status
        const sub = subId ? await stripe.subscriptions.retrieve(subId) : null;
        const priceId  = sub?.items?.data?.[0]?.price?.id || "";
        const tier     = PRICE_TO_TIER[priceId] || "individual";
        const status   = sub?.status || "active";

        await upsertProfile(supabase, {
          userId,
          email:                  session.customer_details?.email || null,
          stripeCustomerId:       custId || null,
          stripeSubscriptionId:   subId  || null,
          subscriptionStatus:     status,
          subscriptionTier:       tier,
          gymId:                  isGym ? (gymId || null) : null,
          gymTier:                isGym ? tier : null,
        });

        console.log(`[stripe-webhook] Checkout complete — user:${userId} tier:${tier} status:${status}`);
        break;
      }

      // ── Subscription updated (renewal, upgrade, downgrade, trial end) ───────
      case "customer.subscription.updated": {
        const sub    = event.data.object as Stripe.Subscription;
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
        const priceId = sub.items?.data?.[0]?.price?.id || "";
        const tier    = PRICE_TO_TIER[priceId] || "individual";
        const userId  = sub.metadata?.userId   || null;
        const gymId   = sub.metadata?.gymId    || null;
        const isGym   = sub.metadata?.isGym === "true";

        await upsertProfileByCustomer(supabase, custId!, {
          stripeSubscriptionId: sub.id,
          subscriptionStatus:   sub.status,
          subscriptionTier:     tier,
          gymId:                isGym ? (gymId || null) : null,
          gymTier:              isGym ? tier : null,
          userId,
        });

        console.log(`[stripe-webhook] Subscription updated — cust:${custId} tier:${tier} status:${sub.status}`);
        break;
      }

      // ── Subscription deleted (user cancelled) ───────────────────────────────
      case "customer.subscription.deleted": {
        const sub    = event.data.object as Stripe.Subscription;
        const custId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

        await upsertProfileByCustomer(supabase, custId!, {
          subscriptionStatus:   "canceled",
          subscriptionTier:     "free",
          gymId:                null,
          gymTier:              null,
        });

        console.log(`[stripe-webhook] Subscription canceled — cust:${custId}`);
        break;
      }

      // ── Payment failed ───────────────────────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const custId  = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;

        await upsertProfileByCustomer(supabase, custId!, {
          subscriptionStatus: "past_due",
        });

        console.log(`[stripe-webhook] Payment failed — cust:${custId}`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error("[stripe-webhook] Handler error:", err);
    // Return 200 anyway so Stripe doesn't retry — log the error instead
    return new Response(JSON.stringify({ received: true, warning: String(err) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

interface ProfileUpdate {
  userId?:                string | null;
  email?:                 string | null;
  stripeCustomerId?:      string | null;
  stripeSubscriptionId?:  string | null;
  subscriptionStatus?:    string | null;
  subscriptionTier?:      string | null;
  gymId?:                 string | null;
  gymTier?:               string | null;
}

async function upsertProfile(supabase: ReturnType<typeof createClient>, p: ProfileUpdate) {
  if (!p.userId && !p.email && !p.stripeCustomerId) return;

  const record: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (p.userId)               record.user_id               = p.userId;
  if (p.email)                record.email                 = p.email;
  if (p.stripeCustomerId)     record.stripe_customer_id    = p.stripeCustomerId;
  if (p.stripeSubscriptionId) record.stripe_subscription_id = p.stripeSubscriptionId;
  if (p.subscriptionStatus)   record.subscription_status   = p.subscriptionStatus;
  if (p.subscriptionTier)     record.subscription_tier     = p.subscriptionTier;
  if (p.gymId !== undefined)  record.gym_id                = p.gymId;
  if (p.gymTier !== undefined) record.gym_tier             = p.gymTier;

  const { error } = await supabase
    .from("rvn_profiles")
    .upsert(record, { onConflict: p.userId ? "user_id" : "email" });

  if (error) console.error("[stripe-webhook] upsertProfile error:", error.message);
}

async function upsertProfileByCustomer(
  supabase: ReturnType<typeof createClient>,
  stripeCustomerId: string,
  updates: Partial<ProfileUpdate>,
) {
  const record: Record<string, unknown> = {
    stripe_customer_id: stripeCustomerId,
    updated_at:         new Date().toISOString(),
  };
  if (updates.userId !== undefined)               record.user_id               = updates.userId;
  if (updates.stripeSubscriptionId !== undefined) record.stripe_subscription_id = updates.stripeSubscriptionId;
  if (updates.subscriptionStatus !== undefined)   record.subscription_status   = updates.subscriptionStatus;
  if (updates.subscriptionTier !== undefined)     record.subscription_tier     = updates.subscriptionTier;
  if (updates.gymId !== undefined)                record.gym_id                = updates.gymId;
  if (updates.gymTier !== undefined)              record.gym_tier              = updates.gymTier;

  const { error } = await supabase
    .from("rvn_profiles")
    .upsert(record, { onConflict: "stripe_customer_id" });

  if (error) console.error("[stripe-webhook] upsertProfileByCustomer error:", error.message);
}
