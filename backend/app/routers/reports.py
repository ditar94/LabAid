"""Reports router for compliance exports (CSV + PDF downloads and JSON previews)."""

import re
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import Antibody, Lab, Lot, User, UserRole
from app.services.csv_renderer import (
    render_audit_trail_csv,
    render_lot_activity_csv,
    render_usage_csv,
    render_usage_trend_csv,
    render_admin_activity_csv,
)
from app.services.pdf_renderer import (
    render_audit_trail_pdf,
    render_lot_activity_pdf,
    render_usage_pdf,
    render_usage_trend_pdf,
    render_admin_activity_pdf,
)
from app.services.report_service import (
    get_audit_trail_data,
    get_lot_activity_data,
    get_lot_activity_range,
    get_usage_data,
    get_usage_range,
    get_usage_trend_data,
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


def _lot_number(db: Session, lot_id: UUID | None) -> str | None:
    if not lot_id:
        return None
    lot = db.query(Lot.lot_number).filter(Lot.id == lot_id).first()
    return lot.lot_number if lot else None


def _slug(text: str, max_len: int = 40) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "-", text.replace(" ", "-"))[:max_len]


def _date_range_part(date_from: date | None, date_to: date | None) -> str:
    """Format date range for filename.

    MonthPicker sends date_to as exclusive (1st of next month).
    Returns: "" (no range), "May2026" (single month), "2026" (full year),
    or "May2026-Jul2026" (multi-month range).
    """
    if not date_from and not date_to:
        return ""
    months = [
        "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ]
    # Convert exclusive date_to to inclusive end month
    end = (date_to - timedelta(days=1)) if date_to else None
    if date_from and end:
        # Full year: Jan–Dec of same year
        if date_from.month == 1 and end.month == 12 and date_from.year == end.year:
            return str(date_from.year)
        # Single month
        if date_from.year == end.year and date_from.month == end.month:
            return f"{months[date_from.month]}{date_from.year}"
        # Multi-month range
        f = f"{months[date_from.month]}{date_from.year}"
        t = f"{months[end.month]}{end.year}"
        return f"{f}-{t}"
    if date_from:
        return f"{months[date_from.month]}{date_from.year}-Present"
    if end:
        return f"Through-{months[end.month]}{end.year}"
    return ""


def _report_filename(
    report_type: str, antibody_name: str, ext: str,
    date_from: date | None = None, date_to: date | None = None,
    lot_number: str | None = None,
) -> str:
    """Build filename: ReportType_Antibody[_LotXXX][_DateRange].ext"""
    ab_part = "AllAntibodies" if not antibody_name else _slug(antibody_name)
    parts = [report_type, ab_part]
    if lot_number:
        parts.append(f"Lot{_slug(lot_number, 20)}")
    date_part = _date_range_part(date_from, date_to)
    if date_part:
        parts.append(date_part)
    return f"{'_'.join(parts)}.{ext}"


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
    lot_num = _lot_number(db, lot_id)
    return _file_response(
        render_lot_activity_csv(data, include_antibody=not antibody_id),
        "text/csv", _report_filename("LotActivity", ab_name, "csv", date_from, date_to, lot_num),
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
    lot_num = _lot_number(db, lot_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_lot_activity_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("LotActivity", ab_name, "pdf", date_from, date_to, lot_num),
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
    lot_num = _lot_number(db, lot_id)
    return _file_response(
        render_usage_csv(data, include_antibody=not antibody_id),
        "text/csv", _report_filename("UsageByLot", ab_name, "csv", date_from, date_to, lot_num),
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
    lot_num = _lot_number(db, lot_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_usage_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("UsageByLot", ab_name, "pdf", date_from, date_to, lot_num),
    )


# ── Usage Trend (by Month) ───────────────────────────────────────────────


@router.get("/usage-trend/range")
def usage_trend_range(
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    mn, mx = get_usage_range(db, lab_id=current_user.lab_id, antibody_id=antibody_id)
    return {
        "min": mn.isoformat() if mn else None,
        "max": mx.isoformat() if mx else None,
    }


@router.get("/usage-trend/preview")
def usage_trend_preview(
    antibody_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_usage_trend_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        date_from=date_from, date_to=date_to,
    )
    return {"rows": data[:200], "total": len(data)}


@router.get("/usage-trend/csv")
def usage_trend_csv(
    antibody_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_usage_trend_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    return _file_response(
        render_usage_trend_csv(data, include_antibody=not antibody_id),
        "text/csv", _report_filename("UsageByMonth", ab_name, "csv", date_from, date_to),
    )


@router.get("/usage-trend/pdf")
def usage_trend_pdf(
    antibody_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_usage_trend_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_usage_trend_pdf(data, lab_name, pulled_by=current_user.full_name),
        "application/pdf", _report_filename("UsageByMonth", ab_name, "pdf", date_from, date_to),
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
    return _file_response(render_admin_activity_csv(data), "text/csv", _report_filename("AdminActivity", "", "csv", date_from, date_to))


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
        "application/pdf", _report_filename("AdminActivity", "", "pdf", date_from, date_to),
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
    return _file_response(render_audit_trail_csv(data), "text/csv", _report_filename("AuditTrail", "", "csv", date_from, date_to))


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
        "application/pdf", _report_filename("AuditTrail", "", "pdf", date_from, date_to),
    )
