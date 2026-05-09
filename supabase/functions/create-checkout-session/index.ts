// Supabase Edge Function — create-checkout-session
// Creates a Stripe Checkout Session server-side so the secret key never touches the browser.
//
// Required Supabase secrets (project dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY        = sk_live_... (or sk_test_... while testing)
//   SUPABASE_SERVICE_ROLE_KEY = already available as a built-in Supabase secret
//
// POST body:
//   { priceId, userId, email, gymId?, isGym?, successUrl, cancelUrl }
//
// Returns:
//   { sessionId }   — pass to stripe.redirectToCheckout({ sessionId })

import Stripe from "https://esm.sh/stripe@14?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return new Response(
        JSON.stringify({ error: "STRIPE_SECRET_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-06-20" });

    // Supabase admin client — reads/writes profiles without RLS restrictions
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { priceId, userId, email, gymId, isGym, successUrl, cancelUrl } = await req.json();

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: "priceId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Find or create Stripe customer ────────────────────────────────────────
    let stripeCustomerId: string | undefined;

    if (userId) {
      // Check if we already have a Stripe customer ID for this user
      const { data: profile } = await supabaseAdmin
        .from("rvn_profiles")
        .select("stripe_customer_id")
        .eq("user_id", userId)
        .maybeSingle();

      stripeCustomerId = profile?.stripe_customer_id || undefined;
    }

    if (!stripeCustomerId && email) {
      // Search Stripe for an existing customer with this email
      const existing = await stripe.customers.list({ email, limit: 1 });
      if (existing.data.length > 0) {
        stripeCustomerId = existing.data[0].id;
      }
    }

    if (!stripeCustomerId) {
      // Create a new Stripe customer
      const customer = await stripe.customers.create({
        email: email || undefined,
        metadata: {
          userId:    userId  || "",
          gymId:     gymId   || "",
          source:    "rvn_os",
        },
      });
      stripeCustomerId = customer.id;

      // Save customer ID to profile immediately so we don't create duplicates
      if (userId) {
        await supabaseAdmin
          .from("rvn_profiles")
          .upsert({
            user_id:            userId,
            email:              email || null,
            stripe_customer_id: stripeCustomerId,
          }, { onConflict: "user_id" });
      }
    }

    // ── Create Checkout Session ────────────────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      customer:             stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode:                 "subscription",
      success_url:          successUrl,
      cancel_url:           cancelUrl,
      subscription_data: {
        trial_period_days: isGym ? 30 : undefined,  // 30-day trial for gym intro plan
        metadata: {
          userId:    userId || "",
          gymId:     gymId  || "",
          isGym:     isGym  ? "true" : "false",
        },
      },
      metadata: {
        userId:    userId || "",
        gymId:     gymId  || "",
        priceId,
      },
      allow_promotion_codes: true,
    });

    return new Response(
      JSON.stringify({ sessionId: session.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[create-checkout-session] error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
