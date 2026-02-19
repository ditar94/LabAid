"""Reports router for compliance exports (CSV + PDF downloads and JSON previews)."""

import csv
import io
import re
from datetime import date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import Antibody, CocktailLot, Lab, Lot, User, UserRole
from app.services.csv_renderer import (
    render_audit_trail_csv,
    render_cocktail_lot_csv,
    render_lot_activity_csv,
    render_usage_csv,
    render_usage_trend_csv,
    render_admin_activity_csv,
)
from app.services.pdf_renderer import (
    render_audit_trail_pdf,
    render_cocktail_lot_pdf,
    render_lot_activity_pdf,
    render_usage_pdf,
    render_usage_trend_pdf,
    render_admin_activity_pdf,
)
from app.services.report_service import (
    get_audit_trail_data,
    get_cocktail_lot_data,
    get_cocktail_lot_range,
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

# All lab roles can view reports (reports are read-only).
# Admin-activity stays restricted to SUPER_ADMIN / LAB_ADMIN.
_REPORT_ROLES = (
    UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR,
    UserRole.TECH, UserRole.READ_ONLY,
)
_ADMIN_ROLES = (UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)


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


def _format_local_time(tz: str | None = None) -> str:
    """Format current time in user's timezone, falling back to server local."""
    if tz:
        try:
            now = datetime.now(ZoneInfo(tz))
            return now.strftime("%Y-%m-%d %H:%M %Z")
        except Exception:
            pass
    return datetime.now().strftime("%Y-%m-%d %H:%M")


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


def _csv_with_metadata(
    csv_bytes: bytes, report_title: str, lab_name: str,
    pulled_by: str, tz: str | None = None,
) -> bytes:
    """Prepend metadata header rows (matching PDF header) to CSV output."""
    now = _format_local_time(tz)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Report", report_title])
    w.writerow(["Lab", lab_name])
    w.writerow(["Pulled By", pulled_by])
    w.writerow(["Generated", now])
    w.writerow([])  # blank separator before data
    return buf.getvalue().encode("utf-8") + csv_bytes


# ── Lot Activity ──────────────────────────────────────────────────────────


@router.get("/lot-activity/range")
def lot_activity_range(
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_lot_activity_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lot_num = _lot_number(db, lot_id)
    csv_bytes = render_lot_activity_csv(data, include_antibody=not antibody_id)
    csv_bytes = _csv_with_metadata(csv_bytes, "Lot Activity", _lab_name(db, current_user.lab_id), current_user.full_name, tz)
    return _file_response(
        csv_bytes, "text/csv",
        _report_filename("LotActivity", ab_name, "csv", date_from, date_to, lot_num),
    )


@router.get("/lot-activity/pdf")
def lot_activity_pdf(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_lot_activity_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lot_num = _lot_number(db, lot_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_lot_activity_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz),
        "application/pdf", _report_filename("LotActivity", ab_name, "pdf", date_from, date_to, lot_num),
    )


# ── Usage Report ──────────────────────────────────────────────────────────


@router.get("/usage/range")
def usage_range(
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_usage_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lot_num = _lot_number(db, lot_id)
    csv_bytes = render_usage_csv(data, include_antibody=not antibody_id)
    csv_bytes = _csv_with_metadata(csv_bytes, "Usage by Lot", _lab_name(db, current_user.lab_id), current_user.full_name, tz)
    return _file_response(
        csv_bytes, "text/csv",
        _report_filename("UsageByLot", ab_name, "csv", date_from, date_to, lot_num),
    )


@router.get("/usage/pdf")
def usage_pdf(
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_usage_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lot_num = _lot_number(db, lot_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_usage_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz),
        "application/pdf", _report_filename("UsageByLot", ab_name, "pdf", date_from, date_to, lot_num),
    )


# ── Usage Trend (by Month) ───────────────────────────────────────────────


@router.get("/usage-trend/range")
def usage_trend_range(
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_usage_trend_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    csv_bytes = render_usage_trend_csv(data, include_antibody=not antibody_id)
    csv_bytes = _csv_with_metadata(csv_bytes, "Usage by Month", _lab_name(db, current_user.lab_id), current_user.full_name, tz)
    return _file_response(
        csv_bytes, "text/csv",
        _report_filename("UsageByMonth", ab_name, "csv", date_from, date_to),
    )


@router.get("/usage-trend/pdf")
def usage_trend_pdf(
    antibody_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_usage_trend_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_usage_trend_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz),
        "application/pdf", _report_filename("UsageByMonth", ab_name, "pdf", date_from, date_to),
    )


# ── Admin Activity ────────────────────────────────────────────────────────


@router.get("/admin-activity/range")
def admin_activity_range(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
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
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    data = get_admin_activity_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
    )
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/admin-activity/csv")
def admin_activity_csv(
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    data = get_admin_activity_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
    )
    csv_bytes = render_admin_activity_csv(data)
    csv_bytes = _csv_with_metadata(csv_bytes, "Admin Activity", _lab_name(db, current_user.lab_id), current_user.full_name, tz)
    return _file_response(
        csv_bytes, "text/csv",
        _report_filename("AdminActivity", "", "csv", date_from, date_to),
    )


@router.get("/admin-activity/pdf")
def admin_activity_pdf(
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_ADMIN_ROLES)),
):
    data = get_admin_activity_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
    )
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_admin_activity_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz),
        "application/pdf", _report_filename("AdminActivity", "", "pdf", date_from, date_to),
    )


# ── Cocktail Lots ────────────────────────────────────────────────────────


@router.get("/cocktail-lots/range")
def cocktail_lots_range(
    recipe_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    mn, mx = get_cocktail_lot_range(db, lab_id=current_user.lab_id, recipe_id=recipe_id)
    return {
        "min": mn.isoformat() if mn else None,
        "max": mx.isoformat() if mx else None,
    }


@router.get("/cocktail-lots/preview")
def cocktail_lots_preview(
    recipe_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_cocktail_lot_data(
        db, lab_id=current_user.lab_id, recipe_id=recipe_id,
        date_from=date_from, date_to=date_to,
    )
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/cocktail-lots/csv")
def cocktail_lots_csv(
    recipe_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_cocktail_lot_data(
        db, lab_id=current_user.lab_id, recipe_id=recipe_id,
        date_from=date_from, date_to=date_to,
    )
    csv_bytes = render_cocktail_lot_csv(data)
    csv_bytes = _csv_with_metadata(csv_bytes, "Cocktail Lots", _lab_name(db, current_user.lab_id), current_user.full_name, tz)
    return _file_response(
        csv_bytes, "text/csv",
        _report_filename("CocktailLots", "", "csv", date_from, date_to),
    )


@router.get("/cocktail-lots/pdf")
def cocktail_lots_pdf(
    recipe_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_cocktail_lot_data(
        db, lab_id=current_user.lab_id, recipe_id=recipe_id,
        date_from=date_from, date_to=date_to,
    )
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_cocktail_lot_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz),
        "application/pdf", _report_filename("CocktailLots", "", "pdf", date_from, date_to),
    )


# ── Audit Trail ───────────────────────────────────────────────────────────


@router.get("/audit-trail/preview")
def audit_trail_preview(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
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
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_audit_trail_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
        entity_type=entity_type, action=action,
    )
    csv_bytes = render_audit_trail_csv(data)
    csv_bytes = _csv_with_metadata(csv_bytes, "Audit Trail", _lab_name(db, current_user.lab_id), current_user.full_name, tz)
    return _file_response(
        csv_bytes, "text/csv",
        _report_filename("AuditTrail", "", "csv", date_from, date_to),
    )


@router.get("/audit-trail/pdf")
def audit_trail_pdf(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    data = get_audit_trail_data(
        db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to,
        entity_type=entity_type, action=action,
    )
    lab_name = _lab_name(db, current_user.lab_id)
    return _file_response(
        render_audit_trail_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz),
        "application/pdf", _report_filename("AuditTrail", "", "pdf", date_from, date_to),
    )


# ── Report Export (with QC documents) ────────────────────────────────────


@router.get("/lot-activity/export")
def lot_activity_export(
    format: str = "zip",
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    from app.services.report_export_service import (
        build_combined_pdf, build_export_zip, fetch_qc_documents,
    )

    data = get_lot_activity_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lot_num = _lot_number(db, lot_id)
    lab_name = _lab_name(db, current_user.lab_id)
    report_pdf = render_lot_activity_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz)

    # Fetch QC docs for relevant lots
    lots_q = db.query(Lot.id).filter(Lot.lab_id == current_user.lab_id)
    if antibody_id:
        lots_q = lots_q.filter(Lot.antibody_id == antibody_id)
    if lot_id:
        lots_q = lots_q.filter(Lot.id == lot_id)
    relevant_lot_ids = [r[0] for r in lots_q.all()]
    docs = fetch_qc_documents(db, current_user.lab_id, relevant_lot_ids)

    report_fn = _report_filename("LotActivity", ab_name, "pdf", date_from, date_to, lot_num)
    if format == "combined_pdf":
        combined = build_combined_pdf(report_pdf, docs)
        return _file_response(
            combined, "application/pdf",
            _report_filename("LotActivity_WithDocs", ab_name, "pdf", date_from, date_to, lot_num),
        )
    else:
        zip_bytes = build_export_zip(report_pdf, report_fn, docs)
        return _file_response(
            zip_bytes, "application/zip",
            _report_filename("LotActivity_WithDocs", ab_name, "zip", date_from, date_to, lot_num),
        )


@router.get("/usage/export")
def usage_export(
    format: str = "zip",
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    from app.services.report_export_service import (
        build_combined_pdf, build_export_zip, fetch_qc_documents,
    )

    data = get_usage_data(
        db, lab_id=current_user.lab_id, antibody_id=antibody_id,
        lot_id=lot_id, date_from=date_from, date_to=date_to,
    )
    ab_name = _antibody_display(db, antibody_id)
    lot_num = _lot_number(db, lot_id)
    lab_name = _lab_name(db, current_user.lab_id)
    report_pdf = render_usage_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz)

    lots_q = db.query(Lot.id).filter(Lot.lab_id == current_user.lab_id)
    if antibody_id:
        lots_q = lots_q.filter(Lot.antibody_id == antibody_id)
    if lot_id:
        lots_q = lots_q.filter(Lot.id == lot_id)
    relevant_lot_ids = [r[0] for r in lots_q.all()]
    docs = fetch_qc_documents(db, current_user.lab_id, relevant_lot_ids)

    report_fn = _report_filename("UsageByLot", ab_name, "pdf", date_from, date_to, lot_num)
    if format == "combined_pdf":
        combined = build_combined_pdf(report_pdf, docs)
        return _file_response(
            combined, "application/pdf",
            _report_filename("UsageByLot_WithDocs", ab_name, "pdf", date_from, date_to, lot_num),
        )
    else:
        zip_bytes = build_export_zip(report_pdf, report_fn, docs)
        return _file_response(
            zip_bytes, "application/zip",
            _report_filename("UsageByLot_WithDocs", ab_name, "zip", date_from, date_to, lot_num),
        )


@router.get("/cocktail-lots/export")
def cocktail_lots_export(
    format: str = "zip",
    recipe_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    tz: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(*_REPORT_ROLES)),
):
    from app.services.report_export_service import (
        build_combined_pdf, build_export_zip, fetch_cocktail_qc_documents,
    )

    data = get_cocktail_lot_data(
        db, lab_id=current_user.lab_id, recipe_id=recipe_id,
        date_from=date_from, date_to=date_to,
    )
    lab_name = _lab_name(db, current_user.lab_id)
    report_pdf = render_cocktail_lot_pdf(data, lab_name, pulled_by=current_user.full_name, tz=tz)

    lots_q = db.query(CocktailLot.id).filter(CocktailLot.lab_id == current_user.lab_id)
    if recipe_id:
        lots_q = lots_q.filter(CocktailLot.recipe_id == recipe_id)
    relevant_ids = [r[0] for r in lots_q.all()]
    docs = fetch_cocktail_qc_documents(db, current_user.lab_id, relevant_ids)

    report_fn = _report_filename("CocktailLots", "", "pdf", date_from, date_to)
    if format == "combined_pdf":
        combined = build_combined_pdf(report_pdf, docs)
        return _file_response(
            combined, "application/pdf",
            _report_filename("CocktailLots_WithDocs", "", "pdf", date_from, date_to),
        )
    else:
        zip_bytes = build_export_zip(report_pdf, report_fn, docs)
        return _file_response(
            zip_bytes, "application/zip",
            _report_filename("CocktailLots_WithDocs", "", "zip", date_from, date_to),
        )
