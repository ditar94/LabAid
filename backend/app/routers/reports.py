"""Reports router for compliance exports (CSV + PDF downloads and JSON previews)."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import Lab, User, UserRole
from app.services.csv_renderer import (
    render_audit_trail_csv,
    render_lot_lifecycle_csv,
    render_qc_history_csv,
)
from app.services.pdf_renderer import (
    render_audit_trail_pdf,
    render_lot_lifecycle_pdf,
    render_qc_history_pdf,
    render_qc_verification_pdf,
)
from app.services.report_service import (
    get_audit_trail_data,
    get_lot_lifecycle_data,
    get_qc_history_data,
    get_qc_verification_data,
)

router = APIRouter(prefix="/api/reports", tags=["reports"])

PREVIEW_LIMIT = 25


def _lab_slug(db: Session, lab_id: UUID) -> str:
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    if lab:
        return lab.name.lower().replace(" ", "-")[:30]
    return "lab"


def _lab_name(db: Session, lab_id: UUID) -> str:
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    return lab.name if lab else "Lab"


def _today() -> str:
    return date.today().isoformat()


# ── Audit Trail ────────────────────────────────────────────────────────────


@router.get("/audit-trail/preview")
def audit_trail_preview(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_audit_trail_data(db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to, entity_type=entity_type, action=action)
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
    data = get_audit_trail_data(db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to, entity_type=entity_type, action=action)
    csv_bytes = render_audit_trail_csv(data)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"audit-trail_{slug}_{_today()}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/audit-trail/pdf")
def audit_trail_pdf(
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_audit_trail_data(db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to, entity_type=entity_type, action=action)
    lab_name = _lab_name(db, current_user.lab_id)
    pdf_bytes = render_audit_trail_pdf(data, lab_name)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"audit-trail_{slug}_{_today()}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Lot Lifecycle ──────────────────────────────────────────────────────────


@router.get("/lot-lifecycle/preview")
def lot_lifecycle_preview(
    lot_id: UUID | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    if not lot_id and not antibody_id:
        raise HTTPException(status_code=400, detail="Provide lot_id or antibody_id")
    data = get_lot_lifecycle_data(db, lab_id=current_user.lab_id, lot_id=lot_id, antibody_id=antibody_id)
    # Flatten for preview: show lot-level info only (events are nested)
    preview = []
    for lot in data[:PREVIEW_LIMIT]:
        preview.append({k: v for k, v in lot.items() if k != "events"})
        preview[-1]["event_count"] = len(lot["events"])
    return {"rows": preview, "total": len(data)}


@router.get("/lot-lifecycle/csv")
def lot_lifecycle_csv(
    lot_id: UUID | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    if not lot_id and not antibody_id:
        raise HTTPException(status_code=400, detail="Provide lot_id or antibody_id")
    data = get_lot_lifecycle_data(db, lab_id=current_user.lab_id, lot_id=lot_id, antibody_id=antibody_id)
    csv_bytes = render_lot_lifecycle_csv(data)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"lot-lifecycle_{slug}_{_today()}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/lot-lifecycle/pdf")
def lot_lifecycle_pdf(
    lot_id: UUID | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    if not lot_id and not antibody_id:
        raise HTTPException(status_code=400, detail="Provide lot_id or antibody_id")
    data = get_lot_lifecycle_data(db, lab_id=current_user.lab_id, lot_id=lot_id, antibody_id=antibody_id)
    lab_name = _lab_name(db, current_user.lab_id)
    pdf_bytes = render_lot_lifecycle_pdf(data, lab_name)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"lot-lifecycle_{slug}_{_today()}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── QC History ─────────────────────────────────────────────────────────────


@router.get("/qc-history/preview")
def qc_history_preview(
    date_from: date | None = None,
    date_to: date | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_qc_history_data(db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to, antibody_id=antibody_id)
    return {"rows": data[:PREVIEW_LIMIT], "total": len(data)}


@router.get("/qc-history/csv")
def qc_history_csv(
    date_from: date | None = None,
    date_to: date | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_qc_history_data(db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to, antibody_id=antibody_id)
    csv_bytes = render_qc_history_csv(data)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"qc-history_{slug}_{_today()}.csv"
    return StreamingResponse(
        iter([csv_bytes]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/qc-history/pdf")
def qc_history_pdf(
    date_from: date | None = None,
    date_to: date | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_qc_history_data(db, lab_id=current_user.lab_id, date_from=date_from, date_to=date_to, antibody_id=antibody_id)
    lab_name = _lab_name(db, current_user.lab_id)
    pdf_bytes = render_qc_history_pdf(data, lab_name)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"qc-history_{slug}_{_today()}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── QC Verification (PDF only) ────────────────────────────────────────────


@router.get("/qc-verification/preview")
def qc_verification_preview(
    lot_id: UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_qc_verification_data(db, lab_id=current_user.lab_id, lot_id=lot_id)
    if not data:
        raise HTTPException(status_code=404, detail="Lot not found")
    # Return subset for preview
    preview = {k: v for k, v in data.items() if k not in ("full_audit_trail",)}
    preview["qc_history"] = data["qc_history"][:PREVIEW_LIMIT]
    preview["document_count"] = len(data["documents"])
    preview["audit_event_count"] = len(data["full_audit_trail"])
    return preview


@router.get("/qc-verification/pdf")
def qc_verification_pdf(
    lot_id: UUID = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    data = get_qc_verification_data(db, lab_id=current_user.lab_id, lot_id=lot_id)
    if not data:
        raise HTTPException(status_code=404, detail="Lot not found")
    lab_name = _lab_name(db, current_user.lab_id)
    pdf_bytes = render_qc_verification_pdf(data, lab_name)
    slug = _lab_slug(db, current_user.lab_id)
    filename = f"qc-verification_{slug}_{data['lot_number']}_{_today()}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
