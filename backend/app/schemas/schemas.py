from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, model_validator

from app.models.models import Designation, LotRequestStatus, QCStatus, TicketStatus, UserRole, VialStatus


# ── Auth ───────────────────────────────────────────────────────────────────


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ImpersonateRequest(BaseModel):
    lab_id: UUID


class ImpersonateResponse(BaseModel):
    token: str
    lab_id: UUID
    lab_name: str


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
    invite_sent: bool
    set_password_link: str | None = None


class ChangePasswordRequest(BaseModel):
    new_password: str


class ResetPasswordResponse(BaseModel):
    email_sent: bool
    set_password_link: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class AcceptInviteRequest(BaseModel):
    token: str
    password: str


class UserUpdateRequest(BaseModel):
    email: EmailStr | None = None
    is_active: bool | None = None


class RoleUpdateRequest(BaseModel):
    role: UserRole


# ── Lab ────────────────────────────────────────────────────────────────────


class LabCreate(BaseModel):
    name: str


class Lab(BaseModel):
    id: UUID
    name: str
    is_active: bool
    billing_status: str = "trial"
    trial_ends_at: datetime | None = None
    settings: dict = {}
    created_at: datetime

    class Config:
        from_attributes = True


class BillingStatusUpdate(BaseModel):
    billing_status: str  # trial, active, past_due, cancelled


class TrialEndsAtUpdate(BaseModel):
    trial_ends_at: datetime | None


class LabSettingsUpdate(BaseModel):
    sealed_counts_only: bool | None = None
    expiry_warn_days: int | None = None
    qc_doc_required: bool | None = None
    support_access_enabled: bool | None = None
    storage_enabled: bool | None = None
    setup_complete: bool | None = None
    billing_url: str | None = None


class SetupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str


# ── Fluorochrome ───────────────────────────────────────────────────────────


class FluorochromeCreate(BaseModel):
    name: str
    color: str


class FluorochromeUpdate(BaseModel):
    color: str


class FluorochromeOut(BaseModel):
    id: UUID
    lab_id: UUID
    name: str
    color: str

    class Config:
        from_attributes = True


# ── Reagent Components ─────────────────────────────────────────────────────


class ReagentComponentBase(BaseModel):
    target: str
    fluorochrome: str
    clone: str | None = None
    ordinal: int = 0


class ReagentComponentOut(ReagentComponentBase):
    id: UUID

    class Config:
        from_attributes = True


# ── Antibody ───────────────────────────────────────────────────────────────


class AntibodyCreate(BaseModel):
    target: str | None = None
    fluorochrome: str | None = None
    clone: str | None = None
    vendor: str | None = None
    catalog_number: str | None = None
    designation: Designation = Designation.RUO
    name: str | None = None
    short_code: str | None = None
    color: str | None = None
    stability_days: int | None = None
    low_stock_threshold: int | None = None
    approved_low_threshold: int | None = None
    components: list[ReagentComponentBase] | None = None

    @model_validator(mode="after")
    def check_required_fields(self):
        if self.designation == Designation.IVD:
            if not self.name or not self.name.strip():
                raise ValueError("Product name is required for IVD reagents")
            if not self.short_code or not self.short_code.strip():
                raise ValueError("Short code is required for IVD reagents")
        else:
            if not self.target or not self.target.strip():
                raise ValueError("Target is required for RUO/ASR antibodies")
            if not self.fluorochrome or not self.fluorochrome.strip():
                raise ValueError("Fluorochrome is required for RUO/ASR antibodies")
        return self


class AntibodyUpdate(BaseModel):
    target: str | None = None
    fluorochrome: str | None = None
    clone: str | None = None
    vendor: str | None = None
    catalog_number: str | None = None
    designation: Designation | None = None
    name: str | None = None
    short_code: str | None = None
    color: str | None = None
    stability_days: int | None = None
    low_stock_threshold: int | None = None
    approved_low_threshold: int | None = None
    components: list[ReagentComponentBase] | None = None


class AntibodyArchiveRequest(BaseModel):
    note: str | None = None


class AntibodyOut(BaseModel):
    id: UUID
    lab_id: UUID
    target: str | None
    fluorochrome: str | None
    clone: str | None
    vendor: str | None
    catalog_number: str | None
    designation: Designation
    name: str | None
    short_code: str | None = None
    color: str | None = None
    stability_days: int | None
    low_stock_threshold: int | None
    approved_low_threshold: int | None
    components: list[ReagentComponentOut] = []
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
    gs1_ai: dict | None = None


class LotArchiveRequest(BaseModel):
    note: str | None = None


class LotOut(BaseModel):
    id: UUID
    antibody_id: UUID
    lab_id: UUID
    lot_number: str
    vendor_barcode: str | None
    gs1_ai: dict | None = None
    expiration_date: date | None
    qc_status: QCStatus
    qc_approved_by: UUID | None
    qc_approved_at: datetime | None
    is_archived: bool = False
    archive_note: str | None = None
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
    file_size: int | None = None
    content_type: str | None = None
    checksum_sha256: str | None = None
    description: str | None = None
    is_qc_document: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class LotStorageLocation(BaseModel):
    unit_id: UUID
    unit_name: str
    is_temporary: bool = False
    vial_count: int


class LotWithCounts(LotOut):
    vial_counts: VialCounts = VialCounts()
    antibody_target: str | None = None
    antibody_fluorochrome: str | None = None
    documents: list[LotDocumentOut] = []
    has_qc_document: bool = False
    storage_locations: list[LotStorageLocation] = []
    has_temp_storage: bool = False
    is_split: bool = False  # True when vials are in multiple containers


class LotUpdate(BaseModel):
    lot_number: str | None = None
    vendor_barcode: str | None = None
    expiration_date: date | None = None


class LotUpdateQC(BaseModel):
    qc_status: QCStatus


# ── Antibody Search ───────────────────────────────────────────────────────


class LotSummary(BaseModel):
    id: UUID
    lot_number: str
    vendor_barcode: str | None = None
    expiration_date: date | None
    qc_status: QCStatus
    vial_counts: VialCounts = VialCounts()
    is_archived: bool = False
    created_at: datetime | None = None


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


class BulkOpenRequest(BaseModel):
    cell_ids: list[UUID]
    force: bool = False
    skip_older_lot_note: str | None = None


class BulkDepleteRequest(BaseModel):
    vial_ids: list[UUID]


class VialCorrectionRequest(BaseModel):
    note: str  # reason for correction


class VialMoveRequest(BaseModel):
    vial_ids: list[UUID]
    target_unit_id: UUID
    start_cell_id: UUID | None = None  # Optional: specify starting cell, otherwise auto-assign
    target_cell_ids: list[UUID] | None = None  # Optional: place vials into exactly these cells


class VialMoveResult(BaseModel):
    moved_count: int
    vials: list["VialOut"]


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
    is_temporary: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class VialSummary(BaseModel):
    id: UUID
    lot_id: UUID
    antibody_id: UUID | None = None
    status: VialStatus
    lot_number: str | None = None
    expiration_date: date | None = None
    antibody_target: str | None = None
    antibody_fluorochrome: str | None = None
    antibody_name: str | None = None
    antibody_short_code: str | None = None
    color: str | None = None
    qc_status: str | None = None

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


class OlderLotSummary(BaseModel):
    id: UUID
    lot_number: str
    vendor_barcode: str | None
    created_at: datetime
    sealed_count: int
    storage_summary: str

    class Config:
        from_attributes = True


class ScanLookupResult(BaseModel):
    lot: LotOut
    antibody: AntibodyOut
    vials: list[VialOut]
    opened_vials: list[VialOut] = []
    storage_grids: list[StorageGridOut] = []
    qc_warning: str | None = None
    older_lots: list[OlderLotSummary] = []
    is_current_lot: bool = False


class ScanEnrichRequest(BaseModel):
    barcode: str


class GUDIDDevice(BaseModel):
    brand_name: str
    company_name: str
    catalog_number: str
    description: str


class ScanEnrichResult(BaseModel):
    parsed: bool
    gtin: str | None = None
    lot_number: str | None = None
    expiration_date: date | None = None
    serial: str | None = None
    catalog_number: str | None = None
    vendor: str | None = None
    all_ais: dict | None = None
    gudid_devices: list[GUDIDDevice] = []
    suggested_designation: str | None = None
    warnings: list[str] = []


class ReturnToStorageRequest(BaseModel):
    cell_id: UUID


# ── Audit ──────────────────────────────────────────────────────────────────


class AuditLogOut(BaseModel):
    id: UUID
    lab_id: UUID
    user_id: UUID
    user_full_name: str | None = None
    action: str
    entity_type: str
    entity_id: UUID
    entity_label: str | None = None
    lot_id: UUID | None = None
    antibody_id: UUID | None = None
    is_support_action: bool = False
    before_state: str | None
    after_state: str | None
    note: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class AuditLogRangeOut(BaseModel):
    min_created_at: datetime | None = None
    max_created_at: datetime | None = None


# ── Support Tickets ──────────────────────────────────────────────────


class TicketCreate(BaseModel):
    subject: str
    message: str


class TicketReplyCreate(BaseModel):
    message: str


class TicketUpdateStatus(BaseModel):
    status: TicketStatus


class TicketReplyOut(BaseModel):
    id: UUID
    ticket_id: UUID
    user_id: UUID
    user_name: str
    message: str
    created_at: datetime


class TicketOut(BaseModel):
    id: UUID
    lab_id: UUID
    user_id: UUID
    user_name: str
    lab_name: str
    subject: str
    message: str
    status: TicketStatus
    created_at: datetime
    updated_at: datetime
    replies: list[TicketReplyOut] = []


# ── Global Search (Super Admin) ──────────────────────────────────────


class GlobalSearchLab(BaseModel):
    id: UUID
    name: str
    is_active: bool


class GlobalSearchAntibody(BaseModel):
    id: UUID
    lab_id: UUID
    lab_name: str
    target: str | None
    fluorochrome: str | None
    clone: str | None
    vendor: str | None
    catalog_number: str | None
    designation: Designation
    name: str | None
    short_code: str | None = None
    color: str | None = None
    components: list[ReagentComponentOut] = []


class GlobalSearchLot(BaseModel):
    id: UUID
    lab_id: UUID
    lab_name: str
    lot_number: str
    antibody_target: str | None
    antibody_fluorochrome: str | None
    qc_status: QCStatus
    vendor_barcode: str | None


class GlobalSearchResult(BaseModel):
    labs: list[GlobalSearchLab] = []
    antibodies: list[GlobalSearchAntibody] = []
    lots: list[GlobalSearchLot] = []


# ── Lot Requests ─────────────────────────────────────────────────────


class LotRequestCreate(BaseModel):
    barcode: str
    lot_number: str | None = None
    expiration_date: date | None = None
    quantity: int
    storage_unit_id: UUID | None = None
    gs1_ai: dict | None = None
    enrichment_data: dict | None = None
    proposed_antibody: dict
    notes: str | None = None


class LotRequestReview(BaseModel):
    lot_number: str | None = None
    expiration_date: date | None = None
    quantity: int | None = None
    storage_unit_id: UUID | None = None
    proposed_antibody: dict | None = None
    rejection_note: str | None = None


class LotRequestOut(BaseModel):
    id: UUID
    lab_id: UUID
    user_id: UUID
    user_full_name: str | None = None
    barcode: str
    lot_number: str | None
    expiration_date: date | None
    quantity: int
    storage_unit_id: UUID | None
    storage_unit_name: str | None = None
    gs1_ai: dict | None = None
    enrichment_data: dict | None = None
    proposed_antibody: dict
    notes: str | None
    status: LotRequestStatus
    reviewed_by: UUID | None
    reviewer_name: str | None = None
    reviewed_at: datetime | None
    rejection_note: str | None
    created_at: datetime

    class Config:
        from_attributes = True
