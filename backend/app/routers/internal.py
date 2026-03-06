import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.models import StripeEvent

logger = logging.getLogger("labaid")

router = APIRouter(prefix="/api/internal", tags=["internal"])


def _verify_oidc_token(request: Request) -> None:
    if not settings.GCP_PROJECT:
        raise HTTPException(status_code=403, detail="Internal endpoints disabled")

    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = auth_header[7:]
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        claims = id_token.verify_oauth2_token(token, google_requests.Request())
        email = claims.get("email", "")
        if not email.endswith(".iam.gserviceaccount.com"):
            raise ValueError(f"Not a service account: {email}")
    except ImportError:
        raise HTTPException(status_code=500, detail="Google auth library not available")
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("OIDC verification failed: %s", e)
        raise HTTPException(status_code=401, detail="Invalid OIDC token")


@router.post("/stripe-cleanup", status_code=200)
def stripe_cleanup(request: Request, db: Session = Depends(get_db)):
    _verify_oidc_token(request)
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    count = db.query(StripeEvent).filter(StripeEvent.processed_at < cutoff).delete()
    db.commit()
    logger.info("Stripe event cleanup: deleted %d events older than 30 days", count)
    return {"deleted": count}


_STRIPE_STATUS_MAP = {
    "active": "active", "trialing": "trial", "past_due": "past_due",
    "canceled": "cancelled", "unpaid": "cancelled",
    "incomplete": "cancelled", "incomplete_expired": "cancelled",
    "paused": "cancelled",
}


@router.post("/reconcile-subscriptions", status_code=200)
def reconcile_subscriptions(request: Request, db: Session = Depends(get_db)):
    _verify_oidc_token(request)
    from app.models.models import Lab
    from app.services.stripe_service import apply_subscription_status, get_stripe_client, _get_item_period

    if not settings.STRIPE_SECRET_KEY:
        return {"checked": 0, "fixed": 0, "errors": ["Stripe not configured"]}

    client = get_stripe_client()
    labs = db.query(Lab).filter(Lab.stripe_subscription_id.isnot(None)).all()
    fixed = 0
    errors = []

    for lab in labs:
        try:
            sub = client.subscriptions.retrieve(lab.stripe_subscription_id)
            expected = _STRIPE_STATUS_MAP.get(sub.status)
            if not expected:
                continue
            is_invoice_pending = lab.billing_status == "invoice_pending" and sub.status == "active"
            if lab.billing_status != expected and not is_invoice_pending:
                logger.info(
                    "Reconciliation fix: lab %s (%s) local=%s stripe=%s",
                    lab.id, lab.name, lab.billing_status, sub.status,
                )
                _, period_end = _get_item_period(sub)
                apply_subscription_status(
                    db, lab, sub.status, subscription_id=sub.id,
                    current_period_end=period_end,
                    trial_end=sub.trial_end,
                    cancel_at_period_end=getattr(sub, "cancel_at_period_end", False),
                )
                if is_invoice_pending:
                    lab.billing_status = "invoice_pending"
                fixed += 1
        except Exception as e:
            errors.append({"lab_id": str(lab.id), "error": str(e)})

    if fixed:
        db.commit()
    logger.info("Reconciliation complete: checked=%d fixed=%d errors=%d", len(labs), fixed, len(errors))
    return {"checked": len(labs), "fixed": fixed, "errors": errors}
