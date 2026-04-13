# Stripe Live-Mode Cutover Runbook

> Last updated: 2026-04-13

## Current State

Both staging and production are running on **Stripe test mode**. No real charges are being processed.

| Environment | Cloud Run Service | Stripe Mode | API Key Secret | Webhook URL |
|-------------|-------------------|-------------|----------------|-------------|
| Staging | labaid-backend-staging | Test | STRIPE_SECRET_KEY_BETA | staging.labaid.io/api/stripe/webhook |
| Production | labaid-backend | **Test (needs cutover)** | STRIPE_SECRET_KEY | labaid.io/api/stripe/webhook |

### What Was Fixed (2026-04-13)

- `STRIPE_PRICE_ID_BETA` was pointing to an inactive $4,000 price — updated to the correct active $4,200 price (`price_1T6m7W485kHcE6iYDRUQx7bM`)
- Both webhook endpoints were missing `invoice.payment_succeeded` — updated to all 16 events
- Staging and production now have identical price IDs and webhook event lists

### Current Secret Manager Values

| Secret | Used By | Value |
|--------|---------|-------|
| STRIPE_SECRET_KEY | Production | `sk_test_...` (MUST become `sk_live_...`) |
| STRIPE_SECRET_KEY_BETA | Staging | `sk_test_...` (stays as-is) |
| STRIPE_WEBHOOK_SECRET | Production | `whsec_Z1KN...` (MUST become live signing secret) |
| STRIPE_WEBHOOK_SECRET_BETA | Staging | `whsec_8VNt...` (stays as-is) |
| STRIPE_PRICE_ID | Production | `price_1T6m7W...` $4,200/yr (MUST become live price ID) |
| STRIPE_PRICE_ID_BETA | Staging | `price_1T6m7W...` $4,200/yr (stays as-is) |
| STRIPE_ENTERPRISE_PRICE_ID | Production | `price_1T7yzF...` $8,400/yr (MUST become live price ID) |
| STRIPE_ENTERPRISE_PRICE_ID_BETA | Staging | `price_1T7yzF...` $8,400/yr (stays as-is) |

---

## Pre-Cutover Checklist

### Step 1: Activate Live Mode in Stripe Dashboard

1. Go to https://dashboard.stripe.com
2. Toggle from "Test mode" to "Live mode"
3. Complete Stripe's business verification:
   - Business details (name, address, EIN/tax ID)
   - Bank account for payouts
   - Identity verification for account representative
4. Stripe may take 1-2 business days to review and approve

### Step 2: Create Live-Mode Products and Prices

Stripe enforces a hard wall between test and live mode. Products and prices do NOT carry over. You must recreate them.

**Option A: Stripe Dashboard (recommended)**

In the Stripe Dashboard with live mode toggled on:

1. Products > Add product
   - Name: `LabAid Standard (1 Year)`
   - Price: $4,200.00 / year
   - Statement descriptor: `LABAID* STANDARD 1YR`
   - Note the new `price_...` ID

2. Products > Add product
   - Name: `LabAid Enterprise (1 Year)`
   - Price: $8,400.00 / year
   - Metadata: `tier = enterprise`
   - Statement descriptor: `LABAID* ENTERPRISE 1YR`
   - Note the new `price_...` ID

**Option B: Stripe CLI**

After configuring live keys in the CLI:

```bash
# Standard
PROD_STD=$(stripe products create --name="LabAid Standard (1 Year)" \
  -d "statement_descriptor=LABAID* STANDARD 1YR" \
  --format=json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

stripe prices create --product="$PROD_STD" \
  --unit-amount=420000 --currency=usd \
  -d "recurring[interval]=year" \
  -d "lookup_key=standard_annual"

# Enterprise
PROD_ENT=$(stripe products create --name="LabAid Enterprise (1 Year)" \
  -d "statement_descriptor=LABAID* ENTERPRISE 1YR" \
  -d "metadata[tier]=enterprise" \
  --format=json | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

stripe prices create --product="$PROD_ENT" \
  --unit-amount=840000 --currency=usd \
  -d "recurring[interval]=year" \
  -d "lookup_key=enterprise_annual"
```

### Step 3: Create Live-Mode Webhook Endpoint

In Stripe Dashboard (live mode) > Developers > Webhooks > Add endpoint:

- **URL**: `https://labaid.io/api/stripe/webhook`
- **Events** (all 16 — must match exactly):

```
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
invoice.paid
invoice.payment_succeeded
invoice.payment_failed
invoice.overdue
invoice.marked_uncollectible
invoice.sent
invoice.upcoming
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.trial_will_end
charge.dispute.created
customer.updated
```

- Copy the **Signing secret** (`whsec_...`) — you'll need it in the next step

### Step 4: Update GCP Secret Manager

Run these commands, replacing placeholders with your actual live values:

```bash
# 1. Live API key (from Stripe Dashboard > Developers > API keys)
echo -n "sk_live_YOUR_LIVE_SECRET_KEY" | \
  gcloud secrets versions add STRIPE_SECRET_KEY --data-file=- --project=labaid-prod

# 2. Live webhook signing secret (from Step 3)
echo -n "whsec_YOUR_LIVE_SIGNING_SECRET" | \
  gcloud secrets versions add STRIPE_WEBHOOK_SECRET --data-file=- --project=labaid-prod

# 3. Live standard price ID (from Step 2)
echo -n "price_YOUR_LIVE_STANDARD_PRICE_ID" | \
  gcloud secrets versions add STRIPE_PRICE_ID --data-file=- --project=labaid-prod

# 4. Live enterprise price ID (from Step 2)
echo -n "price_YOUR_LIVE_ENTERPRISE_PRICE_ID" | \
  gcloud secrets versions add STRIPE_ENTERPRISE_PRICE_ID --data-file=- --project=labaid-prod
```

### Step 5: Deploy to Pick Up New Secrets

Cloud Run reads secrets at container start. Force a new revision:

```bash
# Option A: Push a commit to beta and let the pipeline deploy
git commit --allow-empty -m "Trigger deploy for Stripe live cutover" && git push origin beta

# Option B: Force a new revision directly
gcloud run services update labaid-backend \
  --region us-central1 \
  --project labaid-prod \
  --update-env-vars="STRIPE_CUTOVER=$(date +%s)"
```

### Step 6: Verify

```bash
# 1. Check the health endpoint
curl -s https://labaid.io/api/health | python3 -m json.tool

# 2. Forward live webhooks to your terminal for monitoring
stripe listen --forward-to https://labaid.io/api/stripe/webhook --live

# 3. In another terminal, trigger a test event
stripe trigger checkout.session.completed --live

# 4. Verify in the LabAid super admin dashboard (labaid.io)
#    - Check that lab billing statuses are correct
#    - Try creating a test checkout session
```

---

## Post-Cutover Cleanup

1. **Delete the test-mode webhook endpoint for labaid.io** (it's no longer needed):
   ```bash
   stripe webhook_endpoints delete we_1T6b7f485kHcE6iYQgAuD6bh
   ```

2. **Keep the test-mode webhook for staging.labaid.io** — staging continues using test mode

3. **Existing test-mode subscriptions will NOT carry over** to live mode. Any labs created during testing will show as unsubscribed. They will need to re-subscribe through the normal checkout flow.

4. **Update the Stripe CLI config** to add live mode access:
   ```bash
   stripe login --live
   ```

---

## Architecture After Cutover

```
Staging (staging.labaid.io)          Production (labaid.io)
  ├─ STRIPE_SECRET_KEY_BETA            ├─ STRIPE_SECRET_KEY
  │   (sk_test_...)                    │   (sk_live_...)
  ├─ STRIPE_WEBHOOK_SECRET_BETA        ├─ STRIPE_WEBHOOK_SECRET
  │   (test webhook signing)           │   (live webhook signing)
  ├─ STRIPE_PRICE_ID_BETA              ├─ STRIPE_PRICE_ID
  │   (test price, $4200/yr)           │   (live price, $4200/yr)
  └─ STRIPE_ENTERPRISE_PRICE_ID_BETA   └─ STRIPE_ENTERPRISE_PRICE_ID
      (test price, $8400/yr)               (live price, $8400/yr)

Both environments:
  - Same backend code
  - Same 16 webhook events
  - Same subscription lifecycle logic
  - Staging mirrors production exactly (just different Stripe mode)
```

## CI/CD Maintains Parity

The deploy pipeline (`deploy.yml`) includes Stripe terraform jobs that:
1. Apply identical webhook configuration to both environments
2. Run a **webhook event parity check** — fails the build if the terraform event list doesn't match the backend handler
3. Store webhook signing secrets in Secret Manager automatically

If a developer adds a new event handler to `stripe_webhook.py` but forgets to update `terraform/stripe/webhook.tf`, the build breaks.
