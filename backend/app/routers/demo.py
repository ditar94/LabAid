import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    generate_invite_token,
    hash_password,
    generate_temp_password,
)
from app.middleware.auth import get_current_user, require_role
from app.models.models import DemoLead, Lab, User, UserRole
from app.routers.auth import _set_auth_cookies, limiter
from app.schemas.schemas import (
    DemoExtendRequest,
    DemoGetLinkResponse,
    DemoLabOut,
    DemoLeadOut,
    DemoResendResponse,
    TryDemoRequest,
    TryDemoResponse,
)
from app.services.demo_service import seed_demo_lab, wipe_demo_lab
from app.services.email import send_demo_ready_email

logger = __import__("logging").getLogger(__name__)

router = APIRouter(prefix="/api/demo", tags=["demo"])

DEMO_DURATION_HOURS = 72
DEMO_MAGIC_LINK_EXPIRY_MINUTES = 15
DEMO_RESERVATION_TIMEOUT_MINUTES = 20
DEMO_USER_EMAIL_PATTERN = "demo-{}@demo.labaid.io"


def _run_expire_stale(db: Session) -> dict:
    """Expire stale demo reservations and sessions. Called lazily on key endpoints."""
    now = datetime.now(timezone.utc)
    released = 0
    expired = 0

    # Pass 1: Reservation timeout (magic link never clicked)
    timeout_cutoff = now - timedelta(minutes=DEMO_RESERVATION_TIMEOUT_MINUTES)
    stale_reservations = (
        db.query(Lab)
        .filter(
            Lab.is_demo.is_(True),
            Lab.demo_status == "in_use",
            Lab.demo_assigned_at < timeout_cutoff,
        )
        .all()
    )
    for lab in stale_reservations:
        demo_user = (
            db.query(User)
            .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
            .first()
        )
        if demo_user and demo_user.invite_token is not None:
            lab.demo_status = "available"
            lab.demo_assigned_email = None
            lab.demo_expires_at = None
            lab.demo_assigned_at = None
            demo_user.is_active = False
            demo_user.invite_token = None
            demo_user.invite_token_expires_at = None
            released += 1

    # Pass 2: Expired demos — full reset (wipe + reseed → available)
    # Catches both freshly expired (in_use past deadline) and already-expired labs
    expired_labs = (
        db.query(Lab)
        .filter(
            Lab.is_demo.is_(True),
            or_(
                (Lab.demo_status == "in_use") & (Lab.demo_expires_at < now),
                Lab.demo_status == "expired",
            ),
        )
        .all()
    )
    for lab in expired_labs:
        demo_user = (
            db.query(User)
            .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
            .first()
        )
        if demo_user:
            demo_user.is_active = False

        lead = (
            db.query(DemoLead)
            .filter(DemoLead.demo_lab_id == lab.id, DemoLead.status.in_(["notified", "active"]))
            .first()
        )
        if lead:
            lead.status = "completed"

        # Wipe and reseed the lab data, then mark available
        wipe_demo_lab(db, lab)
        if demo_user:
            seed_demo_lab(db, lab, demo_user)

        lab.demo_status = "available"
        lab.demo_assigned_email = None
        lab.demo_expires_at = None
        lab.demo_assigned_at = None
        lab.demo_cycle_count = (lab.demo_cycle_count or 0) + 1

        _try_assign_waitlisted(db, lab)
        expired += 1

    return {"released": released, "expired": expired}


def _try_assign_waitlisted(db: Session, lab: Lab) -> bool:
    """Assign an available demo lab to the next waitlisted lead. Returns True if assigned."""
    if lab.demo_status != "available":
        return False

    lead = (
        db.query(DemoLead)
        .filter(DemoLead.status == "waitlisted")
        .order_by(DemoLead.created_at)
        .first()
    )
    if not lead:
        return False

    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )
    if not demo_user:
        return False

    now = datetime.now(timezone.utc)
    token = generate_invite_token()
    demo_user.invite_token = token
    demo_user.invite_token_expires_at = now + timedelta(minutes=DEMO_MAGIC_LINK_EXPIRY_MINUTES)
    demo_user.is_active = False

    lab.demo_status = "in_use"
    lab.demo_assigned_email = lead.email
    lab.demo_expires_at = now + timedelta(hours=DEMO_DURATION_HOURS)
    lab.demo_assigned_at = now

    lead.status = "notified"
    lead.demo_lab_id = lab.id
    lead.notified_at = now

    login_link = f"{settings.APP_URL}/api/demo/login?token={token}"

    if settings.DEMO_SEND_EMAIL:
        try:
            send_demo_ready_email(lead.email, login_link)
        except Exception:
            logger.error("Failed to send demo ready email to %s", lead.email)

    return True


# ── Public endpoints ──────────────────────────────────────────────────────


@router.post("/try", response_model=TryDemoResponse)
@limiter.limit("3/minute")
def try_demo(
    request: Request,
    body: TryDemoRequest,
    db: Session = Depends(get_db),
):
    email = body.email.lower().strip()
    now = datetime.now(timezone.utc)

    # Lazy expiration: free up expired demos before processing
    _run_expire_stale(db)
    db.flush()

    # Check for existing active demo (re-entry)
    active_lead = (
        db.query(DemoLead)
        .join(Lab, DemoLead.demo_lab_id == Lab.id)
        .filter(
            DemoLead.email == email,
            Lab.demo_status == "in_use",
            Lab.demo_expires_at > now,
        )
        .first()
    )

    if active_lead:
        # Re-entry: generate new magic link for the same lab
        lab = db.query(Lab).filter(Lab.id == active_lead.demo_lab_id).first()
        demo_user = (
            db.query(User)
            .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
            .first()
        )
        if demo_user:
            token = generate_invite_token()
            demo_user.invite_token = token
            demo_user.invite_token_expires_at = now + timedelta(minutes=DEMO_MAGIC_LINK_EXPIRY_MINUTES)
            db.commit()
            login_link = f"{settings.APP_URL}/api/demo/login?token={token}"
            auto = not settings.DEMO_SEND_EMAIL
            if settings.DEMO_SEND_EMAIL:
                send_demo_ready_email(email, login_link)
            return TryDemoResponse(
                status="assigned",
                login_link=login_link,
                expires_at=lab.demo_expires_at,
                message="Welcome back! Click the link to continue your demo.",
                auto_login=auto,
            )

    # Check for previously used email
    previous_lead = (
        db.query(DemoLead)
        .filter(DemoLead.email == email)
        .first()
    )
    if previous_lead:
        if previous_lead.status == "waitlisted":
            return TryDemoResponse(
                status="waitlisted",
                message="You're already on the waitlist. We'll notify you when a slot opens up.",
                auto_login=False,
            )
        # Any other status (completed, rerequested, notified, active, claimed)
        # where the active_lead check above didn't match → allow re-request
        previous_lead.status = "rerequested"
        db.commit()
        return TryDemoResponse(
            status="waitlisted",
            message="Looks like you've already taken part in a demo. We'll be in touch!",
            auto_login=False,
        )

    # Find next available demo lab (race-safe)
    lab = (
        db.query(Lab)
        .filter(Lab.is_demo.is_(True), Lab.demo_status == "available")
        .with_for_update(skip_locked=True)
        .first()
    )

    if not lab:
        # Waitlist
        lead = DemoLead(
            email=email,
            status="waitlisted",
            source=body.source,
            claimed_ip=request.client.host if request.client else None,
        )
        db.add(lead)
        db.commit()
        return TryDemoResponse(
            status="waitlisted",
            message="All demo slots are currently in use. We'll notify you when one opens up.",
            auto_login=False,
        )

    # Assign the demo lab
    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )
    if not demo_user:
        raise HTTPException(status_code=500, detail="Demo lab has no demo user")

    token = generate_invite_token()
    demo_user.invite_token = token
    demo_user.invite_token_expires_at = now + timedelta(minutes=DEMO_MAGIC_LINK_EXPIRY_MINUTES)
    demo_user.is_active = False  # Activated on magic link click

    lab.demo_status = "in_use"
    lab.demo_assigned_email = email
    lab.demo_expires_at = now + timedelta(hours=DEMO_DURATION_HOURS)
    lab.demo_assigned_at = now

    lead = DemoLead(
        email=email,
        status="notified",
        demo_lab_id=lab.id,
        source=body.source,
        claimed_ip=request.client.host if request.client else None,
        notified_at=now,
    )
    db.add(lead)
    db.commit()

    login_link = f"{settings.APP_URL}/api/demo/login?token={token}"
    auto = not settings.DEMO_SEND_EMAIL
    if settings.DEMO_SEND_EMAIL:
        try:
            send_demo_ready_email(email, login_link)
        except Exception:
            logger.error("Failed to send demo ready email to %s", email)

    return TryDemoResponse(
        status="assigned",
        login_link=login_link,
        expires_at=lab.demo_expires_at,
        message="Your demo is ready! Click the link to log in.",
        auto_login=auto,
    )


@router.get("/login")
@limiter.limit("5/minute")
def demo_login(
    request: Request,
    token: str,
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)

    user = (
        db.query(User)
        .filter(
            User.invite_token == token,
            User.invite_token_expires_at > now,
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired demo link.")

    # Verify this is a demo lab user
    lab = db.query(Lab).filter(Lab.id == user.lab_id).first()
    if not lab or not lab.is_demo:
        raise HTTPException(status_code=400, detail="Invalid demo link.")

    # Activate the user account for the demo session
    user.is_active = True
    user.invite_token = None
    user.invite_token_expires_at = None

    # Mark the lead as active and track login
    lead = (
        db.query(DemoLead)
        .filter(
            DemoLead.demo_lab_id == lab.id,
            DemoLead.status.in_(["notified", "active"]),
        )
        .first()
    )
    if lead:
        lead.status = "active"
        lead.login_count = (lead.login_count or 0) + 1
        lead.last_login_at = now

    # Generate JWT with is_demo claim for middleware checks
    jwt_token = create_access_token({
        "sub": str(user.id),
        "lab_id": str(user.lab_id),
        "role": user.role.value,
        "is_demo": True,
    })

    response = RedirectResponse("/dashboard", status_code=302)
    _set_auth_cookies(response, jwt_token)

    db.commit()
    return response


# ── Admin endpoints (super_admin only) ────────────────────────────────────


@router.get("/labs", response_model=list[DemoLabOut])
def list_demo_labs(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    _run_expire_stale(db)
    db.flush()
    labs = (
        db.query(Lab)
        .filter(Lab.is_demo.is_(True))
        .order_by(Lab.name)
        .all()
    )
    db.commit()
    return labs


@router.post("/labs/{lab_id}/reset", response_model=DemoLabOut)
def reset_demo_lab(
    lab_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if not lab.is_demo:
        raise HTTPException(status_code=403, detail="Cannot reset a non-demo lab")

    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )

    # Mark the associated lead as completed
    if lab.demo_assigned_email:
        lead = (
            db.query(DemoLead)
            .filter(DemoLead.demo_lab_id == lab.id, DemoLead.status.in_(["notified", "active"]))
            .first()
        )
        if lead:
            lead.status = "completed"

    wipe_demo_lab(db, lab)
    if demo_user:
        seed_demo_lab(db, lab, demo_user)

    lab.demo_status = "available"
    lab.demo_assigned_email = None
    lab.demo_expires_at = None
    lab.demo_assigned_at = None
    lab.demo_cycle_count = (lab.demo_cycle_count or 0) + 1

    _try_assign_waitlisted(db, lab)

    db.commit()
    db.refresh(lab)
    return lab


@router.post("/labs/{lab_id}/extend", response_model=DemoLabOut)
def extend_demo_lab(
    lab_id: str,
    body: DemoExtendRequest = DemoExtendRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if not lab.is_demo:
        raise HTTPException(status_code=403, detail="Cannot extend a non-demo lab")
    if not lab.demo_expires_at:
        raise HTTPException(status_code=400, detail="Demo lab has no expiration set")

    lab.demo_expires_at = lab.demo_expires_at + timedelta(hours=body.hours)
    db.commit()
    db.refresh(lab)
    return lab


@router.post("/labs/{lab_id}/revoke", response_model=DemoLabOut)
def revoke_demo_lab(
    lab_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if not lab.is_demo:
        raise HTTPException(status_code=403, detail="Cannot revoke a non-demo lab")

    lab.demo_status = "expired"

    # Mark associated lead as completed
    lead = (
        db.query(DemoLead)
        .filter(DemoLead.demo_lab_id == lab.id, DemoLead.status.in_(["notified", "active"]))
        .first()
    )
    if lead:
        lead.status = "completed"

    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )
    if demo_user:
        demo_user.is_active = False
        demo_user.invite_token = None
        demo_user.invite_token_expires_at = None

    db.commit()
    db.refresh(lab)
    return lab


@router.post("/provision", response_model=list[DemoLabOut])
def provision_demo_labs(
    count: int = 1,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    if count < 1 or count > 10:
        raise HTTPException(status_code=400, detail="Count must be between 1 and 10")

    existing_count = db.query(Lab).filter(Lab.is_demo.is_(True)).count()
    created = []

    for i in range(count):
        n = existing_count + i + 1
        lab = Lab(
            name=f"Demo Lab {n}",
            is_active=True,
            is_demo=True,
            demo_status="available",
            settings={"storage_enabled": True, "qc_doc_required": True, "cocktails_enabled": True, "setup_complete": True},
        )
        db.add(lab)
        db.flush()

        # Create demo user for this lab
        demo_user = User(
            lab_id=lab.id,
            email=DEMO_USER_EMAIL_PATTERN.format(n),
            hashed_password=hash_password(generate_temp_password()),
            full_name=f"Demo User",
            role=UserRole.LAB_ADMIN,
            is_active=False,
        )
        db.add(demo_user)
        db.flush()

        seed_demo_lab(db, lab, demo_user)
        _try_assign_waitlisted(db, lab)
        created.append(lab)

    db.commit()
    for lab in created:
        db.refresh(lab)
    return created


@router.get("/leads", response_model=list[DemoLeadOut])
def list_demo_leads(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    _run_expire_stale(db)
    db.flush()
    leads = (
        db.query(DemoLead)
        .order_by(DemoLead.created_at.desc())
        .limit(200)
        .all()
    )
    db.commit()
    return leads


@router.post("/expire-stale")
def expire_stale_demos(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    result = _run_expire_stale(db)
    db.commit()
    return result


@router.post("/leads/{lead_id}/resend", response_model=DemoResendResponse)
def resend_magic_link(
    lead_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    lead = db.query(DemoLead).filter(DemoLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.status not in ("notified", "active"):
        raise HTTPException(status_code=400, detail="Lead is not in an active demo")
    if not lead.demo_lab_id:
        raise HTTPException(status_code=400, detail="Lead has no assigned demo lab")

    lab = db.query(Lab).filter(Lab.id == lead.demo_lab_id).first()
    if not lab or lab.demo_status != "in_use":
        raise HTTPException(status_code=400, detail="Demo lab is not active")

    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )
    if not demo_user:
        raise HTTPException(status_code=500, detail="Demo lab has no demo user")

    now = datetime.now(timezone.utc)
    token = generate_invite_token()
    demo_user.invite_token = token
    demo_user.invite_token_expires_at = now + timedelta(minutes=DEMO_MAGIC_LINK_EXPIRY_MINUTES)
    db.commit()

    login_link = f"{settings.APP_URL}/api/demo/login?token={token}"
    email_sent = False
    try:
        email_sent = send_demo_ready_email(lead.email, login_link)
    except Exception:
        logger.error("Failed to send demo ready email to %s", lead.email)

    return DemoResendResponse(login_link=login_link, email_sent=email_sent)


@router.post("/labs/{lab_id}/get-link", response_model=DemoGetLinkResponse)
def get_lab_link(
    lab_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if not lab.is_demo:
        raise HTTPException(status_code=400, detail="Not a demo lab")
    if lab.demo_status != "in_use":
        raise HTTPException(status_code=400, detail="Demo lab is not active")

    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )
    if not demo_user:
        raise HTTPException(status_code=500, detail="Demo lab has no demo user")

    now = datetime.now(timezone.utc)
    token = generate_invite_token()
    demo_user.invite_token = token
    demo_user.invite_token_expires_at = now + timedelta(minutes=DEMO_MAGIC_LINK_EXPIRY_MINUTES)
    db.commit()

    login_link = f"{settings.APP_URL}/api/demo/login?token={token}"
    return DemoGetLinkResponse(login_link=login_link)


@router.post("/leads/{lead_id}/assign", response_model=DemoLeadOut)
def assign_lead(
    lead_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    lead = db.query(DemoLead).filter(DemoLead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.status in ("notified", "active"):
        raise HTTPException(status_code=400, detail="Lead already has an active demo")

    lab = (
        db.query(Lab)
        .filter(Lab.is_demo.is_(True), Lab.demo_status == "available")
        .with_for_update(skip_locked=True)
        .first()
    )
    if not lab:
        raise HTTPException(status_code=400, detail="No available demo labs")

    demo_user = (
        db.query(User)
        .filter(User.lab_id == lab.id, User.email.like("demo-%@demo.labaid.io"))
        .first()
    )
    if not demo_user:
        raise HTTPException(status_code=500, detail="Demo lab has no demo user")

    now = datetime.now(timezone.utc)
    token = generate_invite_token()
    demo_user.invite_token = token
    demo_user.invite_token_expires_at = now + timedelta(minutes=DEMO_MAGIC_LINK_EXPIRY_MINUTES)
    demo_user.is_active = False

    lab.demo_status = "in_use"
    lab.demo_assigned_email = lead.email
    lab.demo_expires_at = now + timedelta(hours=DEMO_DURATION_HOURS)
    lab.demo_assigned_at = now

    lead.status = "notified"
    lead.demo_lab_id = lab.id
    lead.notified_at = now

    db.commit()

    login_link = f"{settings.APP_URL}/api/demo/login?token={token}"
    if settings.DEMO_SEND_EMAIL:
        try:
            send_demo_ready_email(lead.email, login_link)
        except Exception:
            logger.error("Failed to send demo ready email to %s", lead.email)

    db.refresh(lead)
    return lead
