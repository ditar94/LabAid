"""Tests for Stripe billing integration."""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from stripe._error import SignatureVerificationError

from app.models.models import Lab, StripeEvent
from app.services.stripe_service import apply_subscription_status, create_trial_subscription


class TestApplySubscriptionStatus:
    def test_active_status(self, db, lab, admin_user):
        lab.billing_status = "trial"
        lab.is_active = True
        db.commit()

        apply_subscription_status(db, lab, "active", subscription_id="sub_123")
        db.commit()
        db.refresh(lab)

        assert lab.billing_status == "active"
        assert lab.is_active is True
        assert lab.stripe_subscription_id == "sub_123"
        assert lab.trial_ends_at is None

    def test_canceled_status(self, db, lab, admin_user):
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        apply_subscription_status(db, lab, "canceled")
        db.commit()
        db.refresh(lab)

        assert lab.billing_status == "cancelled"
        assert lab.is_active is False

    def test_past_due_status(self, db, lab, admin_user):
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        apply_subscription_status(db, lab, "past_due")
        db.commit()
        db.refresh(lab)

        assert lab.billing_status == "past_due"
        assert lab.is_active is True

    def test_trialing_status(self, db, lab, admin_user):
        lab.billing_status = "active"
        db.commit()

        apply_subscription_status(db, lab, "trialing")
        db.commit()
        db.refresh(lab)

        assert lab.billing_status == "trial"
        assert lab.is_active is True

    def test_unknown_status_ignored(self, db, lab, admin_user):
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        apply_subscription_status(db, lab, "unknown_status")
        db.commit()
        db.refresh(lab)

        assert lab.billing_status == "active"
        assert lab.is_active is True


class TestWebhookEndpoint:
    def _make_event(self, event_type, data, event_id=None):
        return {
            "id": event_id or f"evt_{uuid.uuid4().hex[:24]}",
            "type": event_type,
            "data": {"object": data},
        }

    @patch("app.routers.stripe_webhook.settings")
    def test_webhook_missing_signature(self, mock_settings, client, db):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"
        res = client.post("/api/stripe/webhook", content=b"{}")
        assert res.status_code == 400

    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_webhook_invalid_signature(self, mock_settings, mock_construct, client, db):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"
        mock_construct.side_effect = SignatureVerificationError("bad sig", "header")
        res = client.post(
            "/api/stripe/webhook",
            content=b"{}",
            headers={"stripe-signature": "bad_sig"},
        )
        assert res.status_code == 400

    @patch("app.routers.stripe_webhook.get_stripe_client")
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_checkout_completed(self, mock_settings, mock_construct, mock_get_client, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"
        mock_settings.STRIPE_SECRET_KEY = "sk_test"

        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.current_period_end = 1700000000
        mock_client = MagicMock()
        mock_client.subscriptions.retrieve.return_value = mock_sub
        mock_get_client.return_value = mock_client

        event = self._make_event("checkout.session.completed", {
            "client_reference_id": str(lab.id),
            "customer": "cus_test123",
            "subscription": "sub_test456",
            "mode": "subscription",
            "customer_details": {"email": "billing@lab.com"},
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.stripe_customer_id == "cus_test123"
        assert lab.stripe_subscription_id == "sub_test456"
        assert lab.billing_email == "billing@lab.com"
        assert lab.billing_status == "active"
        assert lab.is_active is True

    @patch("app.routers.stripe_webhook.get_stripe_client")
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_event_deduplication(self, mock_settings, mock_construct, mock_get_client, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        mock_sub = MagicMock()
        mock_sub.status = "active"
        mock_sub.current_period_end = 1700000000
        mock_client = MagicMock()
        mock_client.subscriptions.retrieve.return_value = mock_sub
        mock_get_client.return_value = mock_client

        event_id = "evt_dedup_test"
        event = self._make_event("invoice.paid", {
            "customer": "cus_dedup",
            "subscription": "sub_dedup",
        }, event_id=event_id)
        mock_construct.return_value = event

        # Set up lab with stripe_customer_id
        lab.stripe_customer_id = "cus_dedup"
        db.commit()

        # First call processes
        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

        # Second call is deduplicated
        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "already_processed"

    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_subscription_deleted(self, mock_settings, mock_construct, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_cancel"
        lab.stripe_subscription_id = "sub_cancel"
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        event = self._make_event("customer.subscription.deleted", {
            "id": "sub_cancel",
            "customer": "cus_cancel",
            "status": "canceled",
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_status == "cancelled"
        assert lab.is_active is False

    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_invoice_payment_failed(self, mock_settings, mock_construct, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_pastdue"
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        event = self._make_event("invoice.payment_failed", {
            "customer": "cus_pastdue",
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_status == "past_due"
        assert lab.is_active is True


class TestBillingEndpoints:
    def test_billing_status_requires_auth(self, client):
        res = client.get("/api/labs/billing/status")
        assert res.status_code == 401

    def test_billing_status(self, client, auth_headers, lab):
        res = client.get("/api/labs/billing/status", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert data["billing_status"] == "trial"
        assert data["has_subscription"] is False
        assert data["plan_name"] == "Free Trial"

    @patch("app.routers.labs.app_settings")
    def test_checkout_requires_stripe_config(self, mock_settings, client, auth_headers):
        mock_settings.STRIPE_SECRET_KEY = None
        res = client.post("/api/labs/billing/checkout", json={
            "success_url": "http://localhost/success",
            "cancel_url": "http://localhost/cancel",
        }, headers=auth_headers)
        assert res.status_code == 501

    def test_portal_requires_stripe_customer(self, client, auth_headers, lab):
        res = client.post("/api/labs/billing/portal", json={
            "return_url": "http://localhost/billing",
        }, headers=auth_headers)
        # Should fail because lab has no stripe_customer_id, or Stripe not configured
        assert res.status_code in (400, 501)


class TestEventCleanup:
    def test_cleanup_requires_super_admin(self, client, auth_headers):
        res = client.delete("/api/stripe/events/cleanup", headers=auth_headers)
        assert res.status_code == 403

    def test_cleanup_deletes_old_events(self, client, db, super_admin, super_token):
        old = StripeEvent(
            stripe_event_id="evt_old",
            event_type="invoice.paid",
            processed_at=datetime.now(timezone.utc) - timedelta(days=31),
        )
        recent = StripeEvent(
            stripe_event_id="evt_recent",
            event_type="invoice.paid",
            processed_at=datetime.now(timezone.utc) - timedelta(days=1),
        )
        db.add_all([old, recent])
        db.commit()

        res = client.delete(
            "/api/stripe/events/cleanup",
            headers={"Authorization": f"Bearer {super_token}"},
        )
        assert res.status_code == 200
        assert res.json()["deleted"] == 1

        remaining = db.query(StripeEvent).all()
        assert len(remaining) == 1
        assert remaining[0].stripe_event_id == "evt_recent"


class TestTrialExpiration:
    def test_expired_trial_blocks_writes(self, client, auth_headers, lab, db):
        lab.billing_status = "trial"
        lab.trial_ends_at = datetime.now(timezone.utc) - timedelta(days=1)
        lab.is_active = True
        db.commit()

        # Clear the suspension cache so it fetches fresh data
        from app.core.cache import suspension_cache as _suspension_cache
        _suspension_cache.clear()

        # POST should be blocked for expired trial
        res = client.post("/api/antibodies/", json={
            "target": "CD3",
            "fluorochrome": "FITC",
        }, headers=auth_headers)
        assert res.status_code == 403
        assert "trial has expired" in res.json()["detail"]

    def test_active_trial_allows_writes(self, client, auth_headers, lab, db):
        lab.billing_status = "trial"
        lab.trial_ends_at = datetime.now(timezone.utc) + timedelta(days=5)
        lab.is_active = True
        db.commit()

        from app.core.cache import suspension_cache as _suspension_cache
        _suspension_cache.clear()

        # POST should be allowed for active trial (may fail for other reasons but not 403 trial expired)
        res = client.post("/api/antibodies/", json={
            "target": "CD3",
            "fluorochrome": "FITC",
        }, headers=auth_headers)
        assert res.status_code != 403 or "trial" not in res.json().get("detail", "")


class TestCreateTrialSubscription:
    @patch("app.services.stripe_service.get_stripe_client")
    @patch("app.services.stripe_service.settings")
    def test_success(self, mock_settings, mock_get_client, db, lab, admin_user):
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        mock_settings.STRIPE_PRICE_ID = "price_test"

        mock_sub = MagicMock()
        mock_sub.id = "sub_trial_123"
        mock_sub.trial_end = int((datetime.now(timezone.utc) + timedelta(days=7)).timestamp())

        mock_client = MagicMock()
        mock_client.subscriptions.create.return_value = mock_sub
        mock_client.customers.create.return_value = MagicMock(id="cus_new")
        mock_get_client.return_value = mock_client

        result = create_trial_subscription(db, lab)
        db.commit()
        db.refresh(lab)

        assert result == "sub_trial_123"
        assert lab.stripe_subscription_id == "sub_trial_123"
        assert lab.trial_ends_at is not None

    @patch("app.services.stripe_service.get_stripe_client")
    @patch("app.services.stripe_service.settings")
    def test_graceful_failure(self, mock_settings, mock_get_client, db, lab, admin_user):
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        mock_settings.STRIPE_PRICE_ID = "price_test"

        mock_client = MagicMock()
        mock_client.customers.create.side_effect = Exception("Stripe down")
        mock_get_client.return_value = mock_client

        result = create_trial_subscription(db, lab)

        assert result is None
        assert lab.stripe_subscription_id is None


class TestApplySubscriptionStatusTrialEnd:
    def test_syncs_trial_end(self, db, lab, admin_user):
        expected_dt = datetime.now(timezone.utc) + timedelta(days=5)
        trial_end_ts = int(expected_dt.timestamp())
        apply_subscription_status(
            db, lab, "trialing", subscription_id="sub_t1", trial_end=trial_end_ts,
        )
        db.commit()
        db.refresh(lab)

        assert lab.billing_status == "trial"
        assert lab.trial_ends_at is not None
        # SQLite stores naive datetimes, so compare without timezone
        stored = lab.trial_ends_at.replace(tzinfo=timezone.utc) if lab.trial_ends_at.tzinfo is None else lab.trial_ends_at
        assert abs(stored.timestamp() - trial_end_ts) < 2


class TestSubscriptionDeletedGuard:
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_ignores_non_current_subscription(self, mock_settings, mock_construct, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_guard"
        lab.stripe_subscription_id = "sub_new_paid"
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        event = {
            "id": f"evt_{uuid.uuid4().hex[:24]}",
            "type": "customer.subscription.deleted",
            "data": {"object": {
                "id": "sub_old_trial",
                "customer": "cus_guard",
                "status": "canceled",
            }},
        }
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_status == "active"
        assert lab.is_active is True
        assert lab.stripe_subscription_id == "sub_new_paid"

    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_current_subscription_deleted_suspends(self, mock_settings, mock_construct, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_expire"
        lab.stripe_subscription_id = "sub_trial_expire"
        lab.billing_status = "trial"
        lab.is_active = True
        db.commit()

        event = {
            "id": f"evt_{uuid.uuid4().hex[:24]}",
            "type": "customer.subscription.deleted",
            "data": {"object": {
                "id": "sub_trial_expire",
                "customer": "cus_expire",
                "status": "canceled",
            }},
        }
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_status == "cancelled"
        assert lab.is_active is False


def _make_event(event_type, data, event_id=None):
    return {
        "id": event_id or f"evt_{uuid.uuid4().hex[:24]}",
        "type": event_type,
        "data": {"object": data},
    }


class TestSetupModeCheckout:
    @patch("app.routers.stripe_webhook.get_stripe_client")
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_setup_mode_converts_trial(self, mock_settings, mock_construct,
                                        mock_get_client, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

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

        event = _make_event("checkout.session.completed", {
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

        mock_client.payment_methods.attach.assert_called_once()
        mock_client.customers.update.assert_called_once()
        mock_client.subscriptions.update.assert_called_once()
        mock_client.subscriptions.retrieve.assert_called_once_with("sub_trial")

        db.refresh(lab)
        assert lab.billing_status == "active"
        assert lab.stripe_subscription_id == "sub_trial"
        assert lab.current_period_end is not None

    @patch("app.routers.stripe_webhook.get_stripe_client")
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_setup_mode_card_declined(self, mock_settings, mock_construct,
                                       mock_get_client, client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        mock_setup_intent = MagicMock()
        mock_setup_intent.payment_method = "pm_card_declined"

        mock_sub = MagicMock()
        mock_sub.status = "past_due"
        mock_sub.current_period_end = 1700000000
        mock_sub.cancel_at_period_end = False

        mock_client = MagicMock()
        mock_client.setup_intents.retrieve.return_value = mock_setup_intent
        mock_client.subscriptions.retrieve.return_value = mock_sub
        mock_get_client.return_value = mock_client

        lab.stripe_customer_id = "cus_trial2"
        lab.stripe_subscription_id = "sub_trial2"
        lab.billing_status = "trial"
        lab.is_active = True
        db.commit()

        event = _make_event("checkout.session.completed", {
            "client_reference_id": str(lab.id),
            "customer": "cus_trial2",
            "subscription": None,
            "mode": "setup",
            "setup_intent": "seti_456",
            "customer_details": {},
            "metadata": {
                "lab_id": str(lab.id),
                "convert_trial_subscription": "sub_trial2",
            },
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_status == "past_due"


class TestSubscriptionUpdated:
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

        event = _make_event("customer.subscription.updated", {
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

    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_subscription_created(self, mock_settings, mock_construct,
                                   client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_new"
        lab.billing_status = "trial"
        lab.is_active = True
        db.commit()

        event = _make_event("customer.subscription.created", {
            "id": "sub_new",
            "customer": "cus_new",
            "status": "trialing",
            "current_period_end": 1700000000,
            "trial_end": 1700000000,
            "cancel_at_period_end": False,
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.stripe_subscription_id == "sub_new"
        assert lab.billing_status == "trial"


class TestDisputeHandler:
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

        event = _make_event("charge.dispute.created", {
            "charge": "ch_123",
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


class TestCustomerUpdated:
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_syncs_billing_email(self, mock_settings, mock_construct,
                                  client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_email"
        lab.billing_email = "old@lab.com"
        db.commit()

        event = _make_event("customer.updated", {
            "id": "cus_email",
            "email": "new@lab.com",
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_email == "new@lab.com"


class TestSubscriptionDeletedResetsCancel:
    @patch("app.routers.stripe_webhook.stripe.Webhook.construct_event")
    @patch("app.routers.stripe_webhook.settings")
    def test_resets_cancel_at_period_end(self, mock_settings, mock_construct,
                                          client, db, lab, admin_user):
        mock_settings.STRIPE_WEBHOOK_SECRET = "whsec_test"

        lab.stripe_customer_id = "cus_reset"
        lab.stripe_subscription_id = "sub_reset"
        lab.billing_status = "active"
        lab.is_active = True
        lab.cancel_at_period_end = True
        db.commit()

        event = _make_event("customer.subscription.deleted", {
            "id": "sub_reset",
            "customer": "cus_reset",
            "status": "canceled",
        })
        mock_construct.return_value = event

        res = client.post(
            "/api/stripe/webhook",
            content=json.dumps(event).encode(),
            headers={"stripe-signature": "valid_sig"},
        )
        assert res.status_code == 200

        db.refresh(lab)
        assert lab.billing_status == "cancelled"
        assert lab.cancel_at_period_end is False


class TestCheckoutGuards:
    @patch("app.routers.labs.app_settings")
    def test_active_lab_cannot_checkout(self, mock_settings, client, auth_headers, lab, db):
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        lab.billing_status = "active"
        db.commit()

        res = client.post("/api/labs/billing/checkout", json={
            "success_url": "http://localhost/success",
            "cancel_url": "http://localhost/cancel",
        }, headers=auth_headers)
        assert res.status_code == 409

    @patch("app.routers.labs.app_settings")
    def test_past_due_lab_cannot_checkout(self, mock_settings, client, auth_headers, lab, db):
        mock_settings.STRIPE_SECRET_KEY = "sk_test"
        lab.billing_status = "past_due"
        db.commit()

        res = client.post("/api/labs/billing/checkout", json={
            "success_url": "http://localhost/success",
            "cancel_url": "http://localhost/cancel",
        }, headers=auth_headers)
        assert res.status_code == 409


class TestApplyStatusCancelAtPeriodEnd:
    def test_sets_cancel_at_period_end(self, db, lab, admin_user):
        lab.billing_status = "active"
        lab.is_active = True
        db.commit()

        apply_subscription_status(
            db, lab, "active", subscription_id="sub_cap",
            cancel_at_period_end=True,
        )
        db.commit()
        db.refresh(lab)

        assert lab.cancel_at_period_end is True
        assert lab.billing_status == "active"

    def test_clears_cancel_at_period_end(self, db, lab, admin_user):
        lab.billing_status = "active"
        lab.is_active = True
        lab.cancel_at_period_end = True
        db.commit()

        apply_subscription_status(
            db, lab, "active", subscription_id="sub_cap",
            cancel_at_period_end=False,
        )
        db.commit()
        db.refresh(lab)

        assert lab.cancel_at_period_end is False


class TestValidateRedirectUrl:
    def test_valid_origin_accepted(self):
        import app.services.stripe_service as svc
        original = svc._ALLOWED_ORIGINS
        try:
            svc._ALLOWED_ORIGINS = {"https://localhost:5173"}
            result = svc.validate_redirect_url("https://localhost:5173/billing?success=true")
            assert result == "https://localhost:5173/billing?success=true"
        finally:
            svc._ALLOWED_ORIGINS = original

    def test_invalid_origin_rejected(self):
        import app.services.stripe_service as svc
        original = svc._ALLOWED_ORIGINS
        try:
            svc._ALLOWED_ORIGINS = {"https://localhost:5173"}
            with pytest.raises(ValueError, match="Invalid redirect URL origin"):
                svc.validate_redirect_url("https://evil.com/steal")
        finally:
            svc._ALLOWED_ORIGINS = original
