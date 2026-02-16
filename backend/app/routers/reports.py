"""Reports router for compliance exports (CSV + PDF downloads and JSON previews)."""

import re
from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import Antibody, Lab, User, UserRole
from app.services.csv_renderer import (
    render_audit_trail_csv,
    render_lot_activity_csv,
    render_usage_csv,
    render_admin_activity_csv,
)
from app.services.pdf_renderer import (
    render_audit_trail_pdf,
    render_lot_activity_pdf,
    render_usage_pdf,
    render_admin_activity_pdf,
)
from app.services.report_service import (
    get_audit_trail_data,
    get_lot_activity_data,
    get_lot_activity_range,
    get_usage_data,
    get_usage_range,
    get_admin_activity_data,
    get_admin_activity_range,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])

PREVIEW_LIMIT = 50


def _lab_name(db: Session, lab_id: UUID) -> str:
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    return lab.name if lab else "Lab"


def _antibody_display(db: Session, antibody_id: UUID | None) -> str:
    """Resolve antibody name for report headers/filenames. Empty if None."""
    if not antibody_id:
        return ""
    ab = db.query(Antibody).filter(Antibody.id == antibody_id).first()
    if ab:
        return f"{ab.target} {ab.fluorochrome}".strip()
    return ""


def _report_filename(report_type: str, antibody_name: str, ext: str) -> str:
    """Build filename: ReportType_Antibody_YYYYMMDD.ext"""
    ab_part = "AllAntibodies" if not antibody_name else (
        re.sub(r"[^A-Za-z0-9_-]", "-", antibody_name.replace(" ", "-"))[:40]
    )
    return f"{report_type}_{ab_part}_{date.today().strftime('%Y%m%d')}.{ext}"


def _file_response(content: bytes, media_type: str, filename: str):
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Lot Activity ──────────────────────────────────────────────────────────


@router.get("/lot-activity/range")
def lot_activity_range(
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    mn, mx = get_lot_activity_range(db, lab_id=current_user.lab_id, antibody_id=antibody_id)
    return {
        "min": mn.isoformat() if mn else None,
        "max": mx.isoformat() if mx else None,
    }


@router.get("/lot-activity/preview")
def lot_activity_preview(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_lot_activity_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/lot-activity/csv")
def lot_activity_csv(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_lot_activity_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    return _file_response(
        render_lot_activity_csv(data, include_antibody=not antibody_id),
        "text/csv", _report_filename("LotActivity", ab_name, "csv"),
    )


@router.get("/lot-activity/pdf")
def lot_activity_pdf(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_lot_activity_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_lot_activity_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("LotActivity", ab_name, "pdf"),
    )


# ── Usage Report ──────────────────────────────────────────────────────────


@router.get("/usage/range")
def usage_range(
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    mn, mx = get_usage_range(db, lab_id=current_user.lab_id, antibody_id=antibody_id)
    return {
        "min": mn.isoformat() if mn else None,
        "max": mx.isoformat() if mx else None,
    }


@router.get("/usage/preview")
def usage_preview(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_usage_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/usage/csv")
def usage_csv(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_usage_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    return _file_response(
        render_usage_csv(data, include_antibody=not antibody_id),
        "text/csv", _report_filename("UsageReport", ab_name, "csv"),
    )


@router.get("/usage/pdf")
def usage_pdf(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_usage_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_usage_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("UsageReport", ab_name, "pdf"),
    )


# ── Admin Activity ────────────────────────────────────────────────────────


@router.get("/admin-activity/range")
def admin_activity_range(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    mn, mx = get_admin_activity_range(db, lab_id=current_user.lab_id)
    return {
        "min": mn.isoformat() if mn else None,
        "max": mx.isoformat() if mx else None,
    }


@router.get("/admin-activity/preview")
def admin_activity_preview(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    data = get_admin_activity_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
    )
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/admin-activity/csv")
def admin_activity_csv(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    data = get_admin_activity_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
    )
    return _file_response(render_admin_activity_csv(data), "text/csv", _report_filename("AdminActivity", "", "csv"))


@router.get("/admin-activity/pdf")
def admin_activity_pdf(
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    data = get_admin_activity_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
    )
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_admin_activity_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("AdminActivity", "", "pdf"),
    )


# ── Audit Trail ───────────────────────────────────────────────────────────


@router.get("/audit-trail/preview")
def audit_trail_preview(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_audit_trail_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
        entity_type=entity_type, action=action,
    )
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/audit-trail/csv")
def audit_trail_csv(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_audit_trail_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
        entity_type=entity_type, action=action,
    )
    return _file_response(render_audit_trail_csv(data), "text/csv", _report_filename("AuditTrail", "", "csv"))


@router.get("/audit-trail/pdf")
def audit_trail_pdf(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_audit_trail_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
        entity_type=entity_type, action=action,
    )
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_audit_trail_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("AuditTrail", "", "pdf"),
    )
