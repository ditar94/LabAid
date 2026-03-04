import logging
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import (
    Antibody,
    AuditLog,
    DemoLead,
    Lab,
    Lot,
    LotDocument,
    User,
    UserRole,
    Vial,
)
from app.schemas.schemas import (
    AdminDashboardStats,
    AdminSubscriptionSummary,
    AdminTrialSummary,
    ConversionFunnelSummary,
    ConversionPeriodStats,
    DemoLeadOut,
)
from app.services.audit import log_audit
from app.services.object_storage import object_storage
from app.services.stripe_service import get_or_create_customer, get_subscription_details

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/integrity")
def check_integrity(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    """Validate referential integrity and blob consistency across the database."""
    checks: dict = {}

    # 1. Orphaned lots (lot.antibody_id points to non-existent antibody)
    orphaned_lots = (
        db.query(func.count(Lot.id))
        .outerjoin(Antibody, Lot.antibody_id == Antibody.id)
        .filter(Antibody.id.is_(None))
        .scalar()
    )
    checks["orphaned_lots"] = orphaned_lots

    # 2. Orphaned vials (vial.lot_id points to non-existent lot)
    orphaned_vials = (
        db.query(func.count(Vial.id))
        .outerjoin(Lot, Vial.lot_id == Lot.id)
        .filter(Lot.id.is_(None))
        .scalar()
    )
    checks["orphaned_vials"] = orphaned_vials

    # 3. Orphaned documents (document.lot_id points to non-existent lot)
    orphaned_docs = (
        db.query(func.count(LotDocument.id))
        .outerjoin(Lot, LotDocument.lot_id == Lot.id)
        .filter(Lot.id.is_(None))
        .scalar()
    )
    checks["orphaned_documents"] = orphaned_docs

    # 4. Entity counts
    counts = {
        "labs": db.execute(text("SELECT COUNT(*) FROM labs")).scalar(),
        "users": db.execute(text("SELECT COUNT(*) FROM users")).scalar(),
        "antibodies": db.execute(text("SELECT COUNT(*) FROM antibodies")).scalar(),
        "lots": db.execute(text("SELECT COUNT(*) FROM lots")).scalar(),
        "vials": db.execute(text("SELECT COUNT(*) FROM vials")).scalar(),
        "documents": db.execute(text("SELECT COUNT(*) FROM lot_documents")).scalar(),
        "audit_log": db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar(),
    }
    checks["entity_counts"] = counts

    # 5. Audit log span
    audit_span = db.execute(
        text("SELECT MIN(created_at), MAX(created_at) FROM audit_log")
    ).first()
    checks["audit_log_span"] = {
        "earliest": str(audit_span[0]) if audit_span[0] else None,
        "latest": str(audit_span[1]) if audit_span[1] else None,
    }

    # 6. Missing blobs (documents where S3 key exists but blob is missing)
    missing_blobs = []
    if object_storage.enabled:
        s3_docs = (
            db.query(LotDocument.id, LotDocument.file_path)
            .filter(
                ~LotDocument.file_path.startswith("uploads"),
                LotDocument.is_deleted == False,  # noqa: E712
            )
            .all()
        )
        for doc_id, key in s3_docs:
            try:
                object_storage._client.head_object(
                    Bucket=object_storage._bucket, Key=key
                )
            except Exception:
                missing_blobs.append({"id": str(doc_id), "key": key})
    checks["missing_blobs"] = len(missing_blobs)
    if missing_blobs:
        checks["missing_blob_details"] = missing_blobs[:20]  # cap at 20

    # 7. Documents missing metadata (uploaded before checksum tracking)
    docs_without_checksum = (
        db.query(func.count(LotDocument.id))
        .filter(
            LotDocument.checksum_sha256.is_(None),
            LotDocument.is_deleted == False,  # noqa: E712
        )
        .scalar()
    )
    checks["documents_without_checksum"] = docs_without_checksum

    # Overall status
    has_issues = (
        orphaned_lots > 0
        or orphaned_vials > 0
        or orphaned_docs > 0
        or len(missing_blobs) > 0
    )
    return {
        "status": "issues_found" if has_issues else "ok",
        "checks": checks,
    }


@router.post("/purge-deleted-documents")
def purge_deleted_documents(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    """Hard-delete documents that were soft-deleted more than 90 days ago."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    docs = (
        db.query(LotDocument)
        .filter(
            LotDocument.is_deleted == True,  # noqa: E712
            LotDocument.deleted_at < cutoff,
        )
        .all()
    )

    purged = 0
    errors = []
    for doc in docs:
        # Delete blob from storage
        if object_storage.enabled and not doc.file_path.startswith("uploads"):
            try:
                object_storage.delete(doc.file_path)
            except Exception:
                logger.exception("Failed to purge blob: %s", doc.file_path)
                errors.append(str(doc.id))
                continue
        else:
            if os.path.exists(doc.file_path):
                try:
                    os.remove(doc.file_path)
                except OSError:
                    logger.exception("Failed to purge local file: %s", doc.file_path)
                    errors.append(str(doc.id))
                    continue

        log_audit(
            db,
            lab_id=doc.lab_id,
            user_id=current_user.id,
            action="document.purged",
            entity_type="lot",
            entity_id=doc.lot_id,
            before_state={"document_id": str(doc.id), "file_name": doc.file_name},
            note=f"Purged soft-deleted document: {doc.file_name}",
        )
        db.delete(doc)
        purged += 1

    db.commit()
    result = {"detail": f"Purged {purged} documents"}
    if errors:
        result["errors"] = errors
    return result


@router.get("/dashboard", response_model=AdminDashboardStats)
def get_admin_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    now = datetime.now(timezone.utc)
    soon_48h = now + timedelta(hours=48)
    soon_7d = now + timedelta(days=7)
    week_ago = now - timedelta(days=7)

    # Demo metrics
    active_demos = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(True), Lab.demo_status == "in_use", Lab.demo_expires_at > now,
    ).scalar()
    demos_ending_soon = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(True), Lab.demo_status == "in_use",
        Lab.demo_expires_at > now, Lab.demo_expires_at <= soon_48h,
    ).scalar()
    available_demo_labs = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(True), Lab.demo_status == "available",
    ).scalar()
    total_leads = db.query(func.count(DemoLead.id)).scalar()
    recent_leads = db.query(func.count(DemoLead.id)).filter(
        DemoLead.created_at >= week_ago,
    ).scalar()

    # Trial metrics (non-demo, non-suspended labs only)
    active_trials = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "trial", Lab.trial_ends_at > now,
    ).scalar()
    trials_ending_soon_count = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "trial",
        Lab.trial_ends_at > now, Lab.trial_ends_at <= soon_7d,
    ).scalar()
    expired_unconverted_count = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "trial",
        Lab.trial_ends_at <= now,
    ).scalar()

    # Subscription metrics (non-suspended)
    active_subs = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "active",
    ).scalar()
    past_due_subs = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "past_due",
    ).scalar()
    cancelled_subs = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "cancelled",
    ).scalar()

    # Suspended labs count
    suspended_count = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(False),
    ).scalar()

    # Renewal metrics (active subs with period ending within 30 days)
    soon_30d = now + timedelta(days=30)
    renewals_soon_count = db.query(func.count(Lab.id)).filter(
        Lab.is_demo.is_(False), Lab.is_active.is_(True),
        Lab.billing_status == "active",
        Lab.current_period_end.isnot(None),
        Lab.current_period_end <= soon_30d,
        Lab.current_period_end > now,
    ).scalar()

    # Actionable: rerequested leads
    rerequested = (
        db.query(DemoLead)
        .filter(DemoLead.status == "rerequested")
        .order_by(DemoLead.created_at.desc())
        .limit(20)
        .all()
    )

    # Actionable: trials expiring soon (non-suspended)
    expiring_trial_labs = (
        db.query(Lab)
        .filter(
            Lab.is_demo.is_(False), Lab.is_active.is_(True),
            Lab.billing_status == "trial",
            Lab.trial_ends_at > now, Lab.trial_ends_at <= soon_7d,
        )
        .order_by(Lab.trial_ends_at)
        .limit(20)
        .all()
    )

    # Actionable: expired trials not converted (non-suspended)
    expired_trial_labs = (
        db.query(Lab)
        .filter(
            Lab.is_demo.is_(False), Lab.is_active.is_(True),
            Lab.billing_status == "trial",
            Lab.trial_ends_at <= now,
        )
        .order_by(Lab.trial_ends_at.desc())
        .limit(20)
        .all()
    )

    # Actionable: active subscribers (for expand list)
    active_sub_labs = (
        db.query(Lab)
        .filter(
            Lab.is_demo.is_(False), Lab.is_active.is_(True),
            Lab.billing_status == "active",
        )
        .order_by(Lab.name)
        .limit(20)
        .all()
    )

    # Actionable: renewals coming up (period end within 30 days)
    renewing_labs = (
        db.query(Lab)
        .filter(
            Lab.is_demo.is_(False), Lab.is_active.is_(True),
            Lab.billing_status == "active",
            Lab.current_period_end.isnot(None),
            Lab.current_period_end <= soon_30d,
            Lab.current_period_end > now,
        )
        .order_by(Lab.current_period_end)
        .limit(20)
        .all()
    )

    return AdminDashboardStats(
        active_demos=active_demos,
        demos_ending_soon=demos_ending_soon,
        available_demo_labs=available_demo_labs,
        total_leads=total_leads,
        recent_leads=recent_leads,
        active_trials=active_trials,
        trials_ending_soon=trials_ending_soon_count,
        expired_trials_not_converted=expired_unconverted_count,
        active_subscriptions=active_subs,
        past_due_subscriptions=past_due_subs,
        cancelled_subscriptions=cancelled_subs,
        suspended_labs=suspended_count,
        rerequested_leads=rerequested,
        expiring_trials=[
            AdminTrialSummary(
                lab_id=l.id, lab_name=l.name, billing_status=l.billing_status,
                trial_ends_at=l.trial_ends_at, created_at=l.created_at,
                billing_email=l.billing_email,
            ) for l in expiring_trial_labs
        ],
        expired_unconverted=[
            AdminTrialSummary(
                lab_id=l.id, lab_name=l.name, billing_status=l.billing_status,
                trial_ends_at=l.trial_ends_at, created_at=l.created_at,
                billing_email=l.billing_email,
            ) for l in expired_trial_labs
        ],
        renewals_soon=renewals_soon_count,
        active_subscribers_list=[
            AdminSubscriptionSummary(
                lab_id=l.id, lab_name=l.name, billing_status=l.billing_status,
                billing_email=l.billing_email, current_period_end=l.current_period_end,
                created_at=l.created_at,
            ) for l in active_sub_labs
        ],
        renewals_coming_up=[
            AdminSubscriptionSummary(
                lab_id=l.id, lab_name=l.name, billing_status=l.billing_status,
                billing_email=l.billing_email, current_period_end=l.current_period_end,
                created_at=l.created_at,
            ) for l in renewing_labs
        ],
    )


@router.post("/backfill-period-end")
def backfill_period_end(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    labs = db.query(Lab).filter(
        Lab.stripe_subscription_id.isnot(None),
        Lab.current_period_end.is_(None),
    ).all()

    updated = 0
    for lab in labs:
        details = get_subscription_details(lab)
        if details and details.get("current_period_end"):
            lab.current_period_end = datetime.fromtimestamp(
                details["current_period_end"], tz=timezone.utc
            )
            updated += 1
    db.commit()
    return {"updated": updated}


@router.get("/conversion-funnel", response_model=ConversionFunnelSummary)
def get_conversion_funnel(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    results = (
        db.query(DemoLead, User, Lab)
        .outerjoin(User, func.lower(User.email) == func.lower(DemoLead.email))
        .outerjoin(Lab, (User.lab_id == Lab.id) & (Lab.is_demo.is_(False)))
        .order_by(DemoLead.created_at.desc())
        .all()
    )

    rows = []
    converted_to_trial = 0
    converted_to_paid = 0
    monthly: dict[str, dict] = {}
    weekly: dict[str, dict] = {}

    for lead, user, lab in results:
        row = {
            "email": lead.email,
            "demo_date": lead.created_at,
            "demo_source": lead.source,
            "demo_logins": lead.login_count,
        }

        # Time grouping keys
        if lead.created_at:
            m_key = lead.created_at.strftime("%Y-%m")
            w_key = lead.created_at.strftime("%Y-W%W")
            monthly.setdefault(m_key, {"period": m_key, "demos": 0, "trials": 0, "paid": 0})
            weekly.setdefault(w_key, {"period": w_key, "demos": 0, "trials": 0, "paid": 0})
            monthly[m_key]["demos"] += 1
            weekly[w_key]["demos"] += 1

        if lab:
            converted_to_trial += 1
            row["signup_date"] = user.created_at
            row["lab_name"] = lab.name
            row["billing_status"] = lab.billing_status

            if user.created_at:
                tm = user.created_at.strftime("%Y-%m")
                tw = user.created_at.strftime("%Y-W%W")
                monthly.setdefault(tm, {"period": tm, "demos": 0, "trials": 0, "paid": 0})
                weekly.setdefault(tw, {"period": tw, "demos": 0, "trials": 0, "paid": 0})
                monthly[tm]["trials"] += 1
                weekly[tw]["trials"] += 1

            if lab.billing_status == "active":
                converted_to_paid += 1
                row["paid_date"] = lab.billing_updated_at
                if lab.billing_updated_at:
                    pm = lab.billing_updated_at.strftime("%Y-%m")
                    pw = lab.billing_updated_at.strftime("%Y-W%W")
                    monthly.setdefault(pm, {"period": pm, "demos": 0, "trials": 0, "paid": 0})
                    weekly.setdefault(pw, {"period": pw, "demos": 0, "trials": 0, "paid": 0})
                    monthly[pm]["paid"] += 1
                    weekly[pw]["paid"] += 1

        rows.append(row)

    total = len(results)
    return {
        "total_demos": total,
        "converted_to_trial": converted_to_trial,
        "converted_to_paid": converted_to_paid,
        "demo_to_trial_rate": (converted_to_trial / total * 100) if total > 0 else 0,
        "trial_to_paid_rate": (converted_to_paid / converted_to_trial * 100) if converted_to_trial > 0 else 0,
        "monthly": sorted(monthly.values(), key=lambda x: x["period"], reverse=True),
        "weekly": sorted(weekly.values(), key=lambda x: x["period"], reverse=True),
        "rows": rows,
    }


@router.post("/backfill-trial-subscriptions")
def backfill_trial_subscriptions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    from app.core.config import settings
    from app.services.stripe_service import get_stripe_client

    if not settings.STRIPE_SECRET_KEY or not settings.STRIPE_PRICE_ID:
        return {"migrated": 0, "skipped": 0, "errors": ["Stripe not configured"]}

    now = datetime.now(timezone.utc)
    min_remaining = now + timedelta(hours=1)

    labs = db.query(Lab).filter(
        Lab.billing_status == "trial",
        Lab.stripe_subscription_id.is_(None),
        Lab.trial_ends_at > min_remaining,
        Lab.is_demo.is_(False),
    ).all()

    client = get_stripe_client()
    migrated = 0
    skipped = 0
    errors = []

    for lab in labs:
        try:
            if not lab.billing_email:
                admin = db.query(User).filter(
                    User.lab_id == lab.id,
                    User.role.in_([UserRole.LAB_ADMIN, UserRole.SUPER_ADMIN]),
                ).first()
                if admin:
                    lab.billing_email = admin.email
                else:
                    skipped += 1
                    continue

            customer_id = get_or_create_customer(db, lab)
            trial_end_ts = int(lab.trial_ends_at.timestamp())

            subscription = client.subscriptions.create(
                params={
                    "customer": customer_id,
                    "items": [{"price": settings.STRIPE_PRICE_ID}],
                    "trial_end": trial_end_ts,
                    "trial_settings": {
                        "end_behavior": {"missing_payment_method": "cancel"},
                    },
                    "payment_settings": {
                        "save_default_payment_method": "on_subscription",
                    },
                    "metadata": {"lab_id": str(lab.id)},
                },
                options={"idempotency_key": f"backfill_{lab.id}"},
            )
            lab.stripe_subscription_id = subscription.id
            db.flush()
            migrated += 1
        except Exception as e:
            logger.exception("Backfill failed for lab %s", lab.id)
            errors.append(f"lab {lab.id}: {str(e)}")

    db.commit()
    return {"migrated": migrated, "skipped": skipped, "errors": errors}


@router.post("/reconcile-subscriptions")
def reconcile_subscriptions(
    dry_run: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    from app.core.config import settings
    from app.services.stripe_service import apply_subscription_status, get_stripe_client
    if not settings.STRIPE_SECRET_KEY:
        return {"error": "Stripe not configured", "fixed": 0}

    client = get_stripe_client()
    fixed = 0
    errors = []
    changes = []

    # Pass 1: Check labs with existing subscription IDs
    labs_with_sub = db.query(Lab).filter(Lab.stripe_subscription_id.isnot(None)).all()
    for lab in labs_with_sub:
        try:
            sub = client.subscriptions.retrieve(lab.stripe_subscription_id)
            expected_status = {
                "active": "active", "trialing": "trial", "past_due": "past_due",
                "canceled": "cancelled", "unpaid": "cancelled",
                "incomplete": "past_due", "incomplete_expired": "cancelled",
                "paused": "cancelled",
            }.get(sub.status)

            needs_fix = False
            # Preserve invoice_pending when Stripe says active (invoice sent, awaiting payment)
            is_invoice_pending = lab.billing_status == "invoice_pending" and sub.status == "active"
            if expected_status and lab.billing_status != expected_status and not is_invoice_pending:
                needs_fix = True
            elif sub.current_period_end:
                from datetime import datetime as dt
                period_end = dt.fromtimestamp(sub.current_period_end, tz=timezone.utc)
                if lab.current_period_end != period_end:
                    needs_fix = True
            cap = getattr(sub, "cancel_at_period_end", False)
            if lab.cancel_at_period_end != cap:
                needs_fix = True

            if needs_fix:
                changes.append({
                    "lab_id": str(lab.id),
                    "lab_name": lab.name,
                    "old_status": lab.billing_status,
                    "new_status": expected_status or lab.billing_status,
                    "stripe_status": sub.status,
                })
                if not dry_run:
                    apply_subscription_status(
                        db, lab, sub.status, subscription_id=sub.id,
                        current_period_end=sub.current_period_end,
                        trial_end=sub.trial_end,
                        cancel_at_period_end=cap,
                        user_id=current_user.id,
                    )
                    if is_invoice_pending:
                        lab.billing_status = "invoice_pending"
                fixed += 1
        except Exception as e:
            errors.append({"lab_id": str(lab.id), "error": type(e).__name__})

    # Pass 2: Check labs with customer ID but no subscription (orphaned customers)
    orphaned = db.query(Lab).filter(
        Lab.stripe_customer_id.isnot(None),
        Lab.stripe_subscription_id.is_(None),
        Lab.billing_status != "cancelled",
    ).all()
    for lab in orphaned:
        try:
            subs = client.subscriptions.list(params={
                "customer": lab.stripe_customer_id,
                "limit": 1,
            })
            active_subs = [s for s in subs.data if s.status in ("active", "trialing", "past_due")]
            if active_subs:
                sub = active_subs[0]
                changes.append({
                    "lab_id": str(lab.id),
                    "lab_name": lab.name,
                    "old_status": lab.billing_status,
                    "new_status": sub.status,
                    "stripe_status": sub.status,
                    "orphaned": True,
                })
                if not dry_run:
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

    if not dry_run:
        db.commit()
    return {
        "checked": len(labs_with_sub) + len(orphaned),
        "fixed": fixed,
        "dry_run": dry_run,
        "changes": changes,
        "errors": errors,
    }
