from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr

from app.models.models import QCStatus, UserRole, VialStatus


# ── Auth ───────────────────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: UUID
    lab_id: UUID | None
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    must_change_password: bool = False

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str
    role: UserRole = UserRole.TECH


class UserCreateResponse(UserOut):
    temp_password: str


class ChangePasswordRequest(BaseModel):
    new_password: str


class ResetPasswordResponse(BaseModel):
    temp_password: str


# ── Lab ────────────────────────────────────────────────────────────────────


class LabCreate(BaseModel):
    name: str


class Lab(BaseModel):
    id: UUID
    name: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class SetupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str


# ── Fluorochrome ───────────────────────────────────────────────────────────


class FluorochromeCreate(BaseModel):
    name: str
    color: str


class FluorochromeOut(BaseModel):
    id: UUID
    lab_id: UUID
    name: str
    color: str

    class Config:
        from_attributes = True


# ── Antibody ───────────────────────────────────────────────────────────────


class AntibodyCreate(BaseModel):
    target: str
    fluorochrome: str
    clone: str | None = None
    vendor: str | None = None
    catalog_number: str | None = None
    stability_days: int | None = None
    low_stock_threshold: int | None = None


class AntibodyUpdate(BaseModel):
    stability_days: int | None = None
    low_stock_threshold: int | None = None


class AntibodyOut(BaseModel):
    id: UUID
    lab_id: UUID
    target: str
    fluorochrome: str
    clone: str | None
    vendor: str | None
    catalog_number: str | None
    stability_days: int | None
    low_stock_threshold: int | None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ── Lot ────────────────────────────────────────────────────────────────────


class LotCreate(BaseModel):
    antibody_id: UUID
    lot_number: str
    vendor_barcode: str | None = None
    expiration_date: date | None = None


class LotOut(BaseModel):
    id: UUID
    antibody_id: UUID
    lab_id: UUID
    lot_number: str
    vendor_barcode: str | None
    expiration_date: date | None
    qc_status: QCStatus
    qc_approved_by: UUID | None
    qc_approved_at: datetime | None
    created_at: datetime

    class Config:
        from_attributes = True


class VialCounts(BaseModel):
    sealed: int = 0
    opened: int = 0
    depleted: int = 0
    total: int = 0


class LotDocumentOut(BaseModel):
    id: UUID
    lot_id: UUID
    file_name: str
    created_at: datetime

    class Config:
        from_attributes = True


class LotWithCounts(LotOut):
    vial_counts: VialCounts = VialCounts()
    antibody_target: str | None = None
    antibody_fluorochrome: str | None = None
    documents: list[LotDocumentOut] = []


class LotUpdateQC(BaseModel):
    qc_status: QCStatus


# ── Antibody Search ───────────────────────────────────────────────────────


class LotSummary(BaseModel):
    id: UUID
    lot_number: str
    expiration_date: date | None
    qc_status: QCStatus
    vial_counts: VialCounts = VialCounts()


class StorageLocation(BaseModel):
    unit_id: UUID
    unit_name: str
    temperature: str | None
    vial_ids: list[UUID]


class AntibodySearchResult(BaseModel):
    antibody: AntibodyOut
    lots: list[LotSummary]
    total_vial_counts: VialCounts = VialCounts()
    storage_locations: list[StorageLocation]


# ── Vial ───────────────────────────────────────────────────────────────────


class VialIntakeRequest(BaseModel):
    lot_id: UUID
    quantity: int
    storage_unit_id: UUID | None = None  # optionally assign to storage


class VialOut(BaseModel):
    id: UUID
    lot_id: UUID
    lab_id: UUID
    status: VialStatus
    location_cell_id: UUID | None
    received_at: datetime
    opened_at: datetime | None
    opened_by: UUID | None
    open_expiration: date | None
    depleted_at: datetime | None
    depleted_by: UUID | None

    class Config:
        from_attributes = True


class VialOpenRequest(BaseModel):
    cell_id: UUID  # user must click the specific cell


class VialCorrectionRequest(BaseModel):
    note: str  # reason for correction


# ── Storage ────────────────────────────────────────────────────────────────


class StorageUnitCreate(BaseModel):
    name: str
    rows: int
    cols: int
    temperature: str | None = None


class StorageUnitOut(BaseModel):
    id: UUID
    lab_id: UUID
    name: str
    rows: int
    cols: int
    temperature: str | None
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class VialSummary(BaseModel):
    id: UUID
    lot_id: UUID
    status: VialStatus
    lot_number: str | None = None
    expiration_date: date | None = None
    antibody_target: str | None = None
    antibody_fluorochrome: str | None = None
    color: str | None = None

    class Config:
        from_attributes = True


class StorageCellOut(BaseModel):
    id: UUID
    storage_unit_id: UUID
    row: int
    col: int
    label: str | None
    vial_id: UUID | None = None
    vial: VialSummary | None = None

    class Config:
        from_attributes = True


class StorageGridOut(BaseModel):
    unit: StorageUnitOut
    cells: list[StorageCellOut]


# ── Scan / Identify ───────────────────────────────────────────────────────


class ScanLookupRequest(BaseModel):
    barcode: str


class ScanLookupResult(BaseModel):
    lot: LotOut
    antibody: AntibodyOut
    vials: list[VialOut]
    opened_vials: list[VialOut] = []
    storage_grid: StorageGridOut | None = None
    qc_warning: str | None = None


class ReturnToStorageRequest(BaseModel):
    cell_id: UUID


# ── Audit ──────────────────────────────────────────────────────────────────


class AuditLogOut(BaseModel):
    id: UUID
    lab_id: UUID
    user_id: UUID
    action: str
    entity_type: str
    entity_id: UUID
    before_state: str | None
    after_state: str | None
    note: str | None
    created_at: datetime

    class Config:
        from_attributes = True
