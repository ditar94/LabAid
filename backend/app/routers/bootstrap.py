from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from uuid import UUID
from datetime import datetime

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import Fluorochrome, Lab, StorageUnit, User, UserRole
from app.schemas.schemas import (
    FluorochromeOut,
    Lab as LabSchema,
    StorageUnitOut,
    UserOut,
)

router = APIRouter(prefix="/api", tags=["bootstrap"])


class BootstrapResponse(BaseModel):
    user: UserOut
    lab_settings: dict
    fluorochromes: list[FluorochromeOut]
    storage_units: list[StorageUnitOut]
    labs: list[LabSchema] | None = None


@router.get("/bootstrap", response_model=BootstrapResponse)
def bootstrap(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Single call that returns everything needed to render the app shell.
    Replaces GET /auth/me + GET /labs/my-settings + GET /fluorochromes/ +
    GET /storage/units + GET /labs/ (super admin).
    """
    # 1. Lab settings
    lab_settings: dict = {}
    if current_user.lab_id:
        lab = db.query(Lab).filter(Lab.id == current_user.lab_id).first()
        if lab:
            lab_settings = {
                **(lab.settings or {}),
                "billing_status": lab.billing_status,
                "is_active": lab.is_active,
                "trial_ends_at": lab.trial_ends_at.isoformat() if lab.trial_ends_at else None,
            }

    # 2. Fluorochromes
    storage_disabled = lab_settings.get("storage_enabled") is False
    fluorochromes = []
    if current_user.lab_id:
        fluorochromes = (
            db.query(Fluorochrome)
            .filter(Fluorochrome.lab_id == current_user.lab_id)
            .all()
        )

    # 3. Storage units
    storage_units = []
    if current_user.lab_id and not storage_disabled:
        storage_units = (
            db.query(StorageUnit)
            .filter(
                StorageUnit.lab_id == current_user.lab_id,
                StorageUnit.is_active.is_(True),
            )
            .all()
        )

    # 4. Labs list (super admin only, not impersonating)
    labs = None
    is_impersonating = getattr(current_user, "_is_impersonating", False)
    if current_user.role == UserRole.SUPER_ADMIN and not is_impersonating:
        labs = db.query(Lab).order_by(Lab.name).all()

    return BootstrapResponse(
        user=UserOut.model_validate(current_user),
        lab_settings=lab_settings,
        fluorochromes=fluorochromes,
        storage_units=storage_units,
        labs=labs,
    )
