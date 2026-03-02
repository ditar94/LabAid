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
