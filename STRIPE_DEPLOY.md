# How to go live with Stripe payments

Do these steps in order. Takes about 20 minutes total.

---

## Step 1 — Add your Stripe publishable key to the app

1. Go to **stripe.com → Developers → API keys**
2. Copy your **Publishable key** (starts with `pk_live_...`)
3. Open `rvn-os-v6.jsx` and find this line (search for `pk_live_REPLACE_ME`):
   ```
   : "pk_live_REPLACE_ME";
   ```
4. Replace `pk_live_REPLACE_ME` with your actual key
5. Save the file and push to GitHub

---

## Step 2 — Run the database migration in Supabase

1. Go to **supabase.com → your project → SQL Editor**
2. Open the file `supabase/migrations/20260507000000_stripe_subscriptions.sql` from your project folder
3. Copy the entire contents and paste into the SQL Editor
4. Click **Run**
5. You should see "Success. No rows returned"

---

## Step 3 — Deploy the Edge Functions

You need the Supabase CLI installed. Open your terminal and run:

```bash
# Install Supabase CLI (if you don't have it)
npm install -g supabase

# Log in
supabase login

# Link to your project (get your project ref from supabase.com → project settings → General)
supabase link --project-ref pstqlqiitylggqchkzyh

# Deploy both functions
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

---

## Step 4 — Add secrets to Supabase

1. Go to **supabase.com → your project → Edge Functions → Manage secrets**
2. Add these two secrets:

   | Name | Value |
   |------|-------|
   | `STRIPE_SECRET_KEY` | Your Stripe secret key (`sk_live_...` from Stripe → Developers → API keys) |
   | `STRIPE_WEBHOOK_SECRET` | Leave blank for now — you get this in Step 5 |

---

## Step 5 — Set up the Stripe webhook

1. Go to **stripe.com → Developers → Webhooks → Add endpoint**
2. Set the endpoint URL to:
   ```
   https://pstqlqiitylggqchkzyh.supabase.co/functions/v1/stripe-webhook
   ```
3. Under **Events to listen to**, select these four:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Click **Add endpoint**
5. On the next screen, click **Reveal** next to **Signing secret** — copy the `whsec_...` value
6. Go back to Supabase → Edge Functions → Manage secrets
7. Add the secret:

   | Name | Value |
   |------|-------|
   | `STRIPE_WEBHOOK_SECRET` | The `whsec_...` value you just copied |

---

## Step 6 — Test it

1. In Stripe Dashboard, go to **Developers → API keys** and make sure you're in **Test mode** (toggle top right)
2. Open your app and try to subscribe — use Stripe's test card:
   - Card number: `4242 4242 4242 4242`
   - Expiry: any future date
   - CVC: any 3 digits
3. After checkout completes, you should see the green **SUBSCRIPTION ACTIVE** banner in the app
4. Check Supabase → Table Editor → rvn_profiles to confirm the row updated with `subscription_status = active`

Once that works, switch Stripe back to **Live mode** and you're open for business.

---

## Checklist

- [ ] Stripe publishable key added to `rvn-os-v6.jsx`
- [ ] Database migration ran in Supabase SQL Editor
- [ ] Both Edge Functions deployed via CLI
- [ ] `STRIPE_SECRET_KEY` secret added to Supabase
- [ ] Webhook endpoint created in Stripe
- [ ] `STRIPE_WEBHOOK_SECRET` secret added to Supabase
- [ ] Test checkout works with card `4242 4242 4242 4242`
