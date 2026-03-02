# Stripe Integration Hardening Plan

**Date:** 2026-03-02
**Status:** Complete (all items implemented and merged into beta)
**Implemented:** 2026-03-02 — commit `4d7e84e`, merged as `1ca7770`

---

## Background

The LabAid Stripe integration has been through two rounds of fixes addressing critical bugs (trial-to-active race condition, duplicate subscriptions, missing webhook events) and high-severity issues (reactivation race, invoice payment handling, reconciliation). Both a security audit (92% confidence) and an integration expert review (7.5/10) confirmed the core architecture is sound but identified remaining medium and low issues.

This document captures every remaining issue, organized by priority, with exact file locations, code changes, and test requirements.

---

## Medium Priority

These create brief windows of inconsistent state or silently drop important data. Should fix before scaling to more paying customers.

### M1. Setup-mode checkout hardcodes "active" without verifying payment

**Problem:** In `stripe_webhook.py:128`, after ending the trial with `trial_end: "now"`, we immediately write `active` to the database. But `trial_end: "now"` triggers Stripe to create an invoice and charge the card. If the card is declined, the subscription will be `past_due` or `incomplete` — not `active`. The user sees "active" until the next webhook corrects it.

**File:** `backend/app/routers/stripe_webhook.py`, lines 114–128

**Current code:**
```python
client.subscriptions.update(sub_id, params={
    "trial_end": "now",
    "default_payment_method": pm_id,
})
apply_subscription_status(db, lab, "active", subscription_id=sub_id)
```

**Fix:** Retrieve the subscription after the update and use its actual status:
```python
client.subscriptions.update(sub_id, params={
    "trial_end": "now",
    "default_payment_method": pm_id,
})
sub = client.subscriptions.retrieve(sub_id)
apply_subscription_status(
    db, lab, sub.status, subscription_id=sub_id,
    current_period_end=sub.current_period_end,
    cancel_at_period_end=getattr(sub, "cancel_at_period_end", False),
)
```

**Test:** Add `test_checkout_completed_setup_mode` (see M4).

---

### M2. Setup-mode checkout missing `current_period_end`

**Problem:** The setup-mode handler at `stripe_webhook.py:128` calls `apply_subscription_status(db, lab, "active", subscription_id=sub_id)` without passing `current_period_end`. The lab's `current_period_end` column stays NULL after trial conversion. This means:
- The billing page shows no "Current Period" or "Next Payment" dates
- Admin renewal tracking queries miss these labs
- The reconciliation endpoint won't detect the mismatch (it only checks `billing_status`)

**File:** `backend/app/routers/stripe_webhook.py`, line 128

**Fix:** Covered by M1's fix — retrieving the subscription provides `current_period_end`. Same code change.

---

### M3. Dispute handler can't resolve customer from non-expanded objects

**Problem:** In `stripe_webhook.py:264–267`, the dispute handler checks `isinstance(dispute.get("payment_intent"), dict)` and `isinstance(dispute.get("charge"), dict)`. In webhook payloads, these fields are string IDs (not expanded objects), so both checks fail. The handler logs a warning and exits without creating an audit entry. Disputes go unnoticed.

**File:** `backend/app/routers/stripe_webhook.py`, lines 258–292

**Current code:**
```python
if isinstance(dispute.get("payment_intent"), dict):
    customer_id = dispute["payment_intent"].get("customer")
elif isinstance(dispute.get("charge"), dict):
    customer_id = dispute["charge"].get("customer")
```

**Fix:** Fetch the charge from Stripe to resolve the customer:
```python
def _handle_dispute_created(db: Session, dispute: dict) -> None:
    charge_ref = dispute.get("charge")
    amount = dispute.get("amount")
    reason = dispute.get("reason", "unknown")
    customer_id = None

    # Webhook payloads send charge as a string ID, not an expanded object
    if isinstance(charge_ref, str):
        try:
            client = get_stripe_client()
            charge_obj = client.charges.retrieve(charge_ref)
            customer_id = charge_obj.customer
            if isinstance(customer_id, str):
                pass  # already a string ID
            elif customer_id:
                customer_id = customer_id.id
        except Exception:
            logger.warning("charge.dispute.created: could not fetch charge %s", charge_ref)
    elif isinstance(charge_ref, dict):
        customer_id = charge_ref.get("customer")

    if not customer_id:
        logger.warning("charge.dispute.created: could not determine customer_id")
        return

    # ... rest unchanged
```

**Test:** Add `test_dispute_created_resolves_customer` (see M4).

---

### M4. Test coverage gaps for critical code paths

**Problem:** The following code paths have zero test coverage:

| Code path | File | Risk |
|---|---|---|
| Setup-mode checkout (trial→paid via card) | `stripe_webhook.py:110–129` | Most complex webhook handler |
| `customer.subscription.updated` handler | `stripe_webhook.py:203–215` | Primary status sync mechanism |
| `customer.subscription.created` handler | `stripe_webhook.py:188–200` | Fallback status sync |
| `cancel_at_period_end` propagation | `stripe_webhook.py:214` → `stripe_service.py:260` | New feature, untested |
| Invoice subscription creation | `labs.py:447–453`, `stripe_service.py:111–132` | Entire invoice payment path |
| Trial-to-invoice conversion | `labs.py:448–450`, `stripe_service.py:205–219` | Entire invoice conversion path |
| `charge.dispute.created` handler | `stripe_webhook.py:258–292` | Financial risk |
| Reconciliation endpoint | `admin.py:399–439` | Data integrity tool |
| `billing_checkout` branching (trial vs fresh) | `labs.py:317–325` | Core subscription flow |
| `validate_redirect_url` | `stripe_service.py:26–31` | Security boundary |

**File:** `backend/tests/test_stripe.py`

**Tests to add:**

```python
class TestSetupModeCheckout:
    """Tests for trial conversion via card (setup-mode checkout)."""

    @patch("app.routers.stripe_webhook.get_stripe_client")
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_setup_mode_converts_trial(self, mock_settings, mock_construct,
                                        mock_get_client, client, db, lab, admin_user):
        """Setup-mode checkout attaches PM, ends trial, syncs actual status."""
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"
        mock_settings.STRIPE_SECRET_KEY = "sk_test"

        mock_setup_intent = MagicMock()
        mock_setup_intent.payment_method = "pm_card_visa"

        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.current_period_end = 1700000000
        mock_sub.cancel_at_period_end = False

        mock_client = MagicMock()
        mock_client.setup_intents.retrieve.return_value = mock_setup_intent
        mock_client.subscriptions.retrieve.return_value = mock_sub
        mock_get_client.return_value = mock_client

        lab.stripe_customer_id = "cus_trial"
        lab.stripe_subscription_id = "sub_trial"
        lab.billing_status = "trial"
        lab.is_active = True
        db.commit()

        event = self._make_event("checkout.session.completed", {
            "client_reference_id": str(lab.id),
            "customer": "cus_trial",
            "subscription": None,
            "mode": "setup",
            "setup_intent": "seti_123",
            "customer_details": {"email": "billing@lab.com"},
            "metadata": {
                "lab_id": str(lab.id),
                "convert_trial_subscription": "sub_trial",
            },
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        # Verify Stripe API calls
        mock_client.payment_methods.attach.assert_called_once()
        mock_client.customers.update.assert_called_once()
        mock_client.subscriptions.update.assert_called_once()
        mock_client.subscriptions.retrieve.assert_called_once_with("sub_trial")

        db.refresh(lab)
        assert lab.billing_status == "active"
        assert lab.stripe_subscription_id == "sub_trial"  # Same sub, not new
        assert lab.current_period_end is not None


class TestSubscriptionUpdated:
    """Tests for customer.subscription.updated webhook."""

    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_cancel_at_period_end(self, mock_settings, mock_construct,
                                   client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_cap"
        lab.stripe_subscription_id = "sub_cap"
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        event = self._make_event("customer.subscription.updated", {
            "id": "sub_cap",
            "customer": "cus_cap",
            "status": "active",
            "current_period_end": 1700000000,
            "trial_end": None,
            "cancel_at_period_end": True,
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.cancel_at_period_end is True
        assert lab.billing_status == "active"


class TestDisputeHandler:
    """Tests for charge.dispute.created webhook."""

    @patch("app.routers.stripe_webhook.get_stripe_client")
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_resolves_customer_from_charge_string(self, mock_settings,
                                                    mock_construct, mock_get_client,
                                                    client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        mock_charge = MagicMock()
        mock_charge.customer = "cus_disputed"
        mock_client = MagicMock()
        mock_client.charges.retrieve.return_value = mock_charge
        mock_get_client.return_value = mock_client

        lab.stripe_customer_id = "cus_disputed"
        db.commit()

        event = self._make_event("charge.dispute.created", {
            "charge": "ch_123",  # String ID, not expanded
            "amount": 42000,
            "reason": "fraudulent",
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200
        mock_client.charges.retrieve.assert_called_once_with("ch_123")


class TestValidateRedirectUrl:
    """Tests for SSRF protection on redirect URLs."""

    def test_valid_origin_accepted(self):
        from app.services.stripe_service import validate_redirect_url, _ALLOWED_ORIGINS
        # Reset the cached origins
        import app.services.stripe_service as svc
        svc._ALLOWED_ORIGINS = {"https://localhost:5173"}
        assert validate_redirect_url("https://localhost:5173/billing?success=true")

    def test_invalid_origin_rejected(self):
        from app.services.stripe_service import validate_redirect_url
        import app.services.stripe_service as svc
        svc._ALLOWED_ORIGINS = {"https://localhost:5173"}
        with pytest.raises(ValueError, match="Invalid redirect URL origin"):
            validate_redirect_url("https://evil.com/steal")
```

**Note:** Tests that reference `self._make_event` should be placed inside the existing `TestWebhookEndpoint` class or have the helper extracted to a module-level function.

---

## Low Priority

These are correctness refinements and best-practice improvements. No user-facing impact today, but improve robustness as the customer base grows.

### L1. `_handle_subscription_deleted` doesn't reset `cancel_at_period_end`

**Problem:** When a subscription is deleted, the handler passes `cancel_at_period_end` as `None` (not passed). The lab retains `cancel_at_period_end=True` even though it's now cancelled. Not a functional issue (the frontend only shows the banner for active subscriptions), but it's a data cleanliness problem that could confuse admin dashboards.

**File:** `backend/app/routers/stripe_webhook.py`, lines 228–231

**Fix:** Pass `cancel_at_period_end=False`:
```python
apply_subscription_status(
    db, lab, "canceled", subscription_id=subscription["id"],
    current_period_end=subscription.get("current_period_end"),
    cancel_at_period_end=False,
)
```

---

### L2. Reconciliation endpoint doesn't audit-log direct field updates

**Problem:** In `admin.py:429–435`, the reconciliation endpoint directly assigns `lab.current_period_end` and `lab.cancel_at_period_end` without going through `apply_subscription_status`. These changes are not captured in the audit log.

**File:** `backend/app/routers/admin.py`, lines 429–435

**Fix:** Always go through `apply_subscription_status` even when only period/cancel fields differ. Change the `elif` branch to also call `apply_subscription_status`:
```python
# Instead of directly setting lab.current_period_end and lab.cancel_at_period_end,
# call apply_subscription_status which handles audit logging:
apply_subscription_status(
    db, lab, sub.status, subscription_id=sub.id,
    current_period_end=sub.current_period_end,
    trial_end=sub.trial_end,
    cancel_at_period_end=getattr(sub, "cancel_at_period_end", False),
    user_id=current_user.id,
)
fixed += 1
```

This means reconciliation always calls `apply_subscription_status`, which is idempotent (if status matches, it still writes to the audit log, but that's acceptable for a manual admin action).

---

### L3. Reconciliation misses labs with orphaned `stripe_customer_id` but no `stripe_subscription_id`

**Problem:** The reconciliation query at `admin.py:408` only finds labs where `stripe_subscription_id IS NOT NULL`. If a lab's subscription ID was cleared (e.g., during the cancelled-lab resubscription flow at `labs.py:322–324`) but Stripe still has an active subscription for that customer, reconciliation won't find it.

**File:** `backend/app/routers/admin.py`, line 408

**Fix:** Add a second pass that lists active subscriptions for customers with no local subscription:
```python
# Second pass: check for orphaned customers (have customer ID but no subscription)
orphaned = db.query(Lab).filter(
    Lab.stripe_customer_id.isnot(None),
    Lab.stripe_subscription_id.is_(None),
).all()
for lab in orphaned:
    try:
        subs = client.subscriptions.list(params={
            "customer": lab.stripe_customer_id,
            "status": "active",
            "limit": 1,
        })
        if subs.data:
            sub = subs.data[0]
            apply_subscription_status(
                db, lab, sub.status, subscription_id=sub.id,
                current_period_end=sub.current_period_end,
                trial_end=sub.trial_end,
                cancel_at_period_end=getattr(sub, "cancel_at_period_end", False),
                user_id=current_user.id,
            )
            fixed += 1
    except Exception as e:
        errors.append({"lab_id": str(lab.id), "error": type(e).__name__})
```

---

### L4. `past_due` labs can call checkout endpoint directly

**Problem:** The `billing_checkout` endpoint at `labs.py:315` only blocks `billing_status == "active"`. A `past_due` lab could call the API directly to create a new checkout session, potentially creating a second subscription alongside the failing one. The frontend prevents this (shows portal for past_due), but the API is unguarded.

**File:** `backend/app/routers/labs.py`, line 315

**Fix:**
```python
if lab.billing_status in ("active", "past_due"):
    raise HTTPException(
        status_code=409,
        detail="Please use the billing portal to manage your existing subscription",
    )
```

---

### L5. Billing email update outside try/catch for StripeError

**Problem:** In `labs.py:435–440`, the Stripe customer email update happens before the main try/except StripeError block. A Stripe API failure here returns a raw 500 instead of the friendly 502 message.

**File:** `backend/app/routers/labs.py`, lines 435–440

**Fix:** Move the customer email update inside the existing try/except block:
```python
from app.services.stripe_service import (
    create_invoice_subscription, apply_subscription_status,
    convert_trial_to_invoice, get_stripe_client,
)
from stripe._error import StripeError
try:
    if body.billing_email and lab.stripe_customer_id:
        get_stripe_client().customers.update(
            lab.stripe_customer_id,
            params={"email": body.billing_email},
        )

    if lab.stripe_subscription_id and lab.billing_status == "trial":
        # ... existing code
```

---

### L6. Dead `suspension_cache` import in webhook file

**Problem:** `stripe_webhook.py:11` imports `suspension_cache` but never uses it. The cache invalidation correctly happens inside `apply_subscription_status` in the service layer.

**File:** `backend/app/routers/stripe_webhook.py`, line 11

**Fix:** Remove the import:
```python
# Remove this line:
from app.core.cache import suspension_cache
```

---

### L7. Reconciliation endpoint leaks Stripe error details

**Problem:** At `admin.py:437`, `str(e)` is returned in the errors array. Stripe exceptions can contain internal API details (request IDs, API versions). Only super admins see this, but it's still not clean.

**File:** `backend/app/routers/admin.py`, line 437

**Fix:**
```python
except Exception as e:
    errors.append({"lab_id": str(lab.id), "error": type(e).__name__})
```

---

### L8. No `customer.updated` webhook handler for email changes

**Problem:** If a customer changes their billing email in the Stripe Billing Portal, the `customer.updated` event fires. We don't handle this event, so `lab.billing_email` goes stale.

**File:** `backend/app/routers/stripe_webhook.py`

**Fix:** Add a handler:
```python
elif event_type == "customer.updated":
    _handle_customer_updated(db, data)

# ...

def _handle_customer_updated(db: Session, customer: dict) -> None:
    customer_id = customer.get("id")
    if not customer_id:
        return
    lab = _find_lab_by_customer(db, customer_id)
    if not lab:
        return
    email = customer.get("email")
    if email and email != lab.billing_email:
        lab.billing_email = email
```

Also add `customer.updated` to both Stripe webhook endpoints via CLI:
```bash
stripe webhook_endpoints update we_1T6b7f485kHcE6iYQgAuD6bh \
  -d "enabled_events[]=customer.updated"
stripe webhook_endpoints update we_1T5H5M485kHcE6iYKvEF25vy \
  -d "enabled_events[]=customer.updated"
```

---

### L9. `convert_trial_to_invoice` doesn't clear default payment method

**Problem:** When converting a trial to invoice billing at `stripe_service.py:210–218`, the subscription's `default_payment_method` isn't cleared. If the customer had previously added a card (e.g., started the card checkout flow but then chose invoice), Stripe would auto-charge that card instead of sending an invoice.

**File:** `backend/app/services/stripe_service.py`, lines 210–218

**Fix:** Explicitly set `default_payment_method` to empty:
```python
client.subscriptions.update(
    lab.stripe_subscription_id,
    params={
        "collection_method": "send_invoice",
        "days_until_due": 30,
        "trial_end": "now",
        "description": description,
        "default_payment_method": "",
    },
)
```

---

## Informational / Future Considerations

These require no action now but are worth tracking.

| Item | Notes |
|---|---|
| **Stripe API version** | Pinned to `2024-12-18.acacia`. Latest is `2026-02-25.clover`. Review changelog before upgrading. |
| **No email notifications** | Trial expiring, payment failed, subscription cancelled — all logged but no emails sent. Critical for payment recovery at scale. |
| **No coupon/promotion codes** | `allow_promotion_codes: true` not set on checkout sessions. Add when needed for sales. |
| **No subscription pause** | Only cancel is supported. Stripe supports pausing — could add if customers request it. |
| **`incomplete` status maps to `PAST_DUE` with `is_active=True`** | Generous — a declined first payment still grants access for up to 23 hours. Acceptable given the auto-expiry. |
| **Broad exception swallowing** | `create_trial_subscription` and `get_subscription_details` catch all exceptions. Exception logging now includes `type(e).__name__` for better diagnostics. Consider further narrowing to `stripe.StripeError` in the future. |
| **~~Reconciliation has no dry-run mode~~** | ~~Implemented — `dry_run` query parameter added to `POST /admin/reconcile-subscriptions`.~~ |

---

## Implementation Order

All items have been implemented. Original sequence:

1. **M1 + M2** (same code change — retrieve sub after update) — Done
2. **M3** (dispute handler fix) — Done
3. **L1** (reset cancel_at_period_end on delete) — Done
4. **L4** (guard past_due checkout) — Done
5. **L5** (move email update into try/catch) — Done
6. **L6** (remove dead import) — Done
7. **L7** (sanitize error messages) — Done
8. **M4** (13 new tests added, 37 total Stripe tests) — Done
9. **L2** (reconciliation audit logging) — Done
10. **L3** (reconciliation orphan check) — Done
11. **L8** (customer.updated handler + Stripe CLI) — Done
12. **L9** (clear payment method on invoice conversion) — Done

**Note:** The original L8 (serve billing status from local state instead of live Stripe API call) was intentionally dropped — the live API call is the correct behavior for a "Stripe as source of truth" architecture, ensuring the billing page always shows real-time data.

---

## Verification Checklist

After implementation, run:

```bash
# Python syntax check on all modified files
python3 -c "import ast; ast.parse(open('backend/app/routers/stripe_webhook.py').read())"
python3 -c "import ast; ast.parse(open('backend/app/routers/labs.py').read())"
python3 -c "import ast; ast.parse(open('backend/app/routers/admin.py').read())"
python3 -c "import ast; ast.parse(open('backend/app/services/stripe_service.py').read())"

# Run all tests
cd backend && SECRET_KEY=test-secret-key DATABASE_URL="sqlite://" .venv/bin/python -m pytest tests/test_stripe.py -v

# TypeScript check (frontend unchanged, but verify)
cd frontend && npx tsc --noEmit -p tsconfig.app.json

# Verify Stripe webhook endpoints have all events
stripe webhook_endpoints list
```
