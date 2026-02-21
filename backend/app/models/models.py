import enum
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


# ── Enums ──────────────────────────────────────────────────────────────────


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    LAB_ADMIN = "lab_admin"
    SUPERVISOR = "supervisor"
    TECH = "tech"
    READ_ONLY = "read_only"


class QCStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    FAILED = "failed"


class VialStatus(str, enum.Enum):
    SEALED = "sealed"
    OPENED = "opened"
    DEPLETED = "depleted"
    ARCHIVED = "archived"


class TicketStatus(str, enum.Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    RESOLVED = "resolved"
    CLOSED = "closed"


class LotRequestStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class Designation(str, enum.Enum):
    IVD = "ivd"
    RUO = "ruo"
    ASR = "asr"


class BillingStatus(str, enum.Enum):
    TRIAL = "trial"
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"


class CocktailLotStatus(str, enum.Enum):
    ACTIVE = "active"
    DEPLETED = "depleted"
    ARCHIVED = "archived"


# ── Models ─────────────────────────────────────────────────────────────────


class Lab(Base):
    __tablename__ = "labs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=False, unique=True)
    is_active = Column(Boolean, default=True, nullable=False)
    billing_status = Column(String(20), nullable=False, server_default="trial", default="trial")
    billing_updated_at = Column(DateTime(timezone=True), nullable=True)
    trial_ends_at = Column(DateTime(timezone=True), nullable=True)
    settings = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="lab")
    antibodies = relationship("Antibody", back_populates="lab")
    storage_units = relationship("StorageUnit", back_populates="lab")
    fluorochromes = relationship("Fluorochrome", back_populates="lab")
    cocktail_recipes = relationship("CocktailRecipe", back_populates="lab")


class Fluorochrome(Base):
    __tablename__ = "fluorochromes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    name = Column(String(100), nullable=False)
    color = Column(String(7), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False, server_default="true")

    lab = relationship("Lab", back_populates="fluorochromes")


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=True)
    email = Column(String(255), nullable=False, unique=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(200), nullable=False)
    role = Column(Enum(UserRole, values_callable=lambda e: [x.value for x in e]), nullable=False, default=UserRole.TECH)
    is_active = Column(Boolean, default=True, nullable=False)
    must_change_password = Column(Boolean, default=False, nullable=False)
    invite_token = Column(String(64), nullable=True, unique=True, index=True)
    invite_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lab = relationship("Lab", back_populates="users")


class Antibody(Base):
    __tablename__ = "antibodies"
    __table_args__ = (
        Index('idx_antibody_normalized', 'lab_id', 'target_normalized', 'fluorochrome_normalized'),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    target = Column(String(100), nullable=True)  # e.g., CD3, CD4, CD45
    fluorochrome = Column(String(100), nullable=True)  # e.g., FITC, PE, APC
    clone = Column(String(100))
    vendor = Column(String(200))
    catalog_number = Column(String(100))
    designation = Column(
        Enum(Designation, values_callable=lambda e: [x.value for x in e]),
        nullable=False, default=Designation.RUO, server_default="ruo",
    )
    name = Column(String(300), nullable=True)  # IVD product name
    short_code = Column(String(10), nullable=True)  # abbreviation for grid cells
    color = Column(String(7), nullable=True)  # hex color for IVD grid tinting
    stability_days = Column(Integer, nullable=True)  # secondary expiration after opening
    low_stock_threshold = Column(Integer, nullable=True)
    approved_low_threshold = Column(Integer, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Normalized columns for cross-lab matching (UPPERCASE, stripped of spaces/hyphens)
    target_normalized = Column(String(100), nullable=True)
    fluorochrome_normalized = Column(String(100), nullable=True)
    name_normalized = Column(String(255), nullable=True)

    lab = relationship("Lab", back_populates="antibodies")
    lots = relationship("Lot", back_populates="antibody")
    components = relationship("ReagentComponent", back_populates="antibody", cascade="all, delete-orphan", order_by="ReagentComponent.ordinal")


class ReagentComponent(Base):
    __tablename__ = "reagent_components"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    antibody_id = Column(UUID(as_uuid=True), ForeignKey("antibodies.id", ondelete="CASCADE"), nullable=False)
    target = Column(String(100), nullable=False)
    fluorochrome = Column(String(100), nullable=False)
    clone = Column(String(100), nullable=True)
    ordinal = Column(Integer, nullable=False, default=0)

    antibody = relationship("Antibody", back_populates="components")


class Lot(Base):
    __tablename__ = "lots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    antibody_id = Column(
        UUID(as_uuid=True), ForeignKey("antibodies.id"), nullable=False
    )
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    lot_number = Column(String(100), nullable=False)
    vendor_barcode = Column(String(255))  # what the scanner reads
    gs1_ai = Column(JSON, nullable=True)  # parsed GS1 Application Identifiers
    expiration_date = Column(Date)
    qc_status = Column(Enum(QCStatus, values_callable=lambda e: [x.value for x in e]), nullable=False, default=QCStatus.PENDING)
    qc_approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    qc_approved_at = Column(DateTime(timezone=True), nullable=True)
    is_archived = Column(Boolean, default=False, nullable=False, server_default="false")
    archive_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    antibody = relationship("Antibody", back_populates="lots")
    vials = relationship("Vial", back_populates="lot")
    qc_approver = relationship("User", foreign_keys=[qc_approved_by])
    documents = relationship("LotDocument", back_populates="lot")


class LotDocument(Base):
    __tablename__ = "lot_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lot_id = Column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size = Column(BigInteger, nullable=True)  # bytes
    content_type = Column(String(100), nullable=True)
    checksum_sha256 = Column(String(64), nullable=True)
    description = Column(String(500), nullable=True)
    is_qc_document = Column(Boolean, default=False, nullable=False, server_default="false")
    storage_class = Column(String(20), nullable=True, server_default="hot")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_deleted = Column(Boolean, default=False, nullable=False, server_default="false")
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    lot = relationship("Lot", back_populates="documents")
    user = relationship("User", foreign_keys=[user_id])


class Vial(Base):
    __tablename__ = "vials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lot_id = Column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    status = Column(Enum(VialStatus, values_callable=lambda e: [x.value for x in e]), nullable=False, default=VialStatus.SEALED)
    location_cell_id = Column(
        UUID(as_uuid=True), ForeignKey("storage_cells.id"), nullable=True
    )
    received_at = Column(DateTime(timezone=True), server_default=func.now())
    opened_at = Column(DateTime(timezone=True), nullable=True)
    opened_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    open_expiration = Column(Date, nullable=True)  # stability-based expiration
    depleted_at = Column(DateTime(timezone=True), nullable=True)
    depleted_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    opened_for_qc = Column(Boolean, default=False, nullable=False, server_default="false")

    lot = relationship("Lot", back_populates="vials")
    location_cell = relationship("StorageCell", back_populates="vial")
    opener = relationship("User", foreign_keys=[opened_by])
    depleter = relationship("User", foreign_keys=[depleted_by])


class StorageUnit(Base):
    __tablename__ = "storage_units"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    name = Column(String(200), nullable=False)  # e.g., "Freezer Box A1"
    rows = Column(Integer, nullable=False)
    cols = Column(Integer, nullable=False)
    temperature = Column(String(50))  # e.g., "-20°C", "4°C"
    is_active = Column(Boolean, default=True, nullable=False)
    is_temporary = Column(Boolean, default=False, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lab = relationship("Lab", back_populates="storage_units")
    cells = relationship(
        "StorageCell", back_populates="storage_unit", cascade="all, delete-orphan"
    )


class StorageCell(Base):
    __tablename__ = "storage_cells"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    storage_unit_id = Column(
        UUID(as_uuid=True), ForeignKey("storage_units.id"), nullable=False
    )
    row = Column(Integer, nullable=False)  # 0-indexed
    col = Column(Integer, nullable=False)  # 0-indexed
    label = Column(String(20))  # e.g., "A1", "B3"

    storage_unit = relationship("StorageUnit", back_populates="cells")
    vial = relationship("Vial", back_populates="location_cell", uselist=False)


class AuditLog(Base):
    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_log_lab_created", "lab_id", "created_at"),
        Index("ix_audit_log_entity", "entity_type", "entity_id"),
        Index("ix_audit_log_action", "action"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    action = Column(String(100), nullable=False)  # e.g., "vial.opened", "lot.qc_approved"
    entity_type = Column(String(50), nullable=False)  # e.g., "vial", "lot"
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    before_state = Column(Text, nullable=True)  # JSON snapshot
    after_state = Column(Text, nullable=True)  # JSON snapshot
    note = Column(Text, nullable=True)  # for corrections
    is_support_action = Column(Boolean, default=False, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User")


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    subject = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(
        Enum(TicketStatus, values_callable=lambda e: [x.value for x in e]),
        nullable=False,
        default=TicketStatus.OPEN,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    lab = relationship("Lab")
    creator = relationship("User")
    replies = relationship("TicketReply", back_populates="ticket", order_by="TicketReply.created_at")


class TicketReply(Base):
    __tablename__ = "ticket_replies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("support_tickets.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    ticket = relationship("SupportTicket", back_populates="replies")
    author = relationship("User")


class LotRequest(Base):
    __tablename__ = "lot_requests"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    barcode = Column(String(255), nullable=False)
    lot_number = Column(String(100), nullable=True)
    expiration_date = Column(Date, nullable=True)
    quantity = Column(Integer, nullable=False)
    storage_unit_id = Column(UUID(as_uuid=True), ForeignKey("storage_units.id"), nullable=True)
    gs1_ai = Column(JSON, nullable=True)
    enrichment_data = Column(JSON, nullable=True)
    proposed_antibody = Column(JSON, nullable=False)
    notes = Column(Text, nullable=True)
    status = Column(
        Enum(LotRequestStatus, values_callable=lambda e: [x.value for x in e]),
        nullable=False,
        default=LotRequestStatus.PENDING,
    )
    reviewed_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    rejection_note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lab = relationship("Lab")
    submitter = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


# ── Cocktail Tracking ─────────────────────────────────────────────────────


class CocktailRecipe(Base):
    __tablename__ = "cocktail_recipes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    name = Column(String(300), nullable=False)
    description = Column(Text, nullable=True)
    shelf_life_days = Column(Integer, nullable=False)
    max_renewals = Column(Integer, nullable=True)  # null = unlimited
    is_active = Column(Boolean, default=True, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    lab = relationship("Lab", back_populates="cocktail_recipes")
    components = relationship(
        "CocktailRecipeComponent", back_populates="recipe",
        cascade="all, delete-orphan", order_by="CocktailRecipeComponent.ordinal",
    )
    lots = relationship("CocktailLot", back_populates="recipe")


class CocktailRecipeComponent(Base):
    __tablename__ = "cocktail_recipe_components"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("cocktail_recipes.id", ondelete="CASCADE"), nullable=False)
    antibody_id = Column(UUID(as_uuid=True), ForeignKey("antibodies.id"), nullable=True)
    free_text_name = Column(String(300), nullable=True)
    volume_ul = Column(Integer, nullable=True)
    ordinal = Column(Integer, nullable=False, default=0)

    recipe = relationship("CocktailRecipe", back_populates="components")
    antibody = relationship("Antibody")


class CocktailLot(Base):
    __tablename__ = "cocktail_lots"
    __table_args__ = (
        Index("ix_cocktail_lots_lab_recipe", "lab_id", "recipe_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("cocktail_recipes.id"), nullable=False)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    lot_number = Column(String(100), nullable=False)
    vendor_barcode = Column(String(255), nullable=True)
    preparation_date = Column(Date, nullable=False)
    expiration_date = Column(Date, nullable=False)
    status = Column(
        Enum(CocktailLotStatus, values_callable=lambda e: [x.value for x in e]),
        nullable=False, default=CocktailLotStatus.ACTIVE,
    )
    qc_status = Column(
        Enum(QCStatus, values_callable=lambda e: [x.value for x in e]),
        nullable=False, default=QCStatus.PENDING,
    )
    qc_approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    qc_approved_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    renewal_count = Column(Integer, nullable=False, default=0, server_default="0")
    last_renewed_at = Column(DateTime(timezone=True), nullable=True)
    location_cell_id = Column(UUID(as_uuid=True), ForeignKey("storage_cells.id"), nullable=True)
    is_archived = Column(Boolean, default=False, nullable=False, server_default="false")
    archive_note = Column(Text, nullable=True)
    test_count = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    recipe = relationship("CocktailRecipe", back_populates="lots")
    lab = relationship("Lab")
    qc_approver = relationship("User", foreign_keys=[qc_approved_by])
    creator = relationship("User", foreign_keys=[created_by])
    location_cell = relationship("StorageCell")
    source_lots = relationship(
        "CocktailLotSource", back_populates="cocktail_lot",
        cascade="all, delete-orphan",
    )
    documents = relationship("CocktailLotDocument", back_populates="cocktail_lot")


class CocktailLotSource(Base):
    __tablename__ = "cocktail_lot_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cocktail_lot_id = Column(UUID(as_uuid=True), ForeignKey("cocktail_lots.id", ondelete="CASCADE"), nullable=False)
    component_id = Column(UUID(as_uuid=True), ForeignKey("cocktail_recipe_components.id"), nullable=False)
    source_lot_id = Column(UUID(as_uuid=True), ForeignKey("lots.id"), nullable=False)

    cocktail_lot = relationship("CocktailLot", back_populates="source_lots")
    component = relationship("CocktailRecipeComponent")
    source_lot = relationship("Lot")


class CocktailLotDocument(Base):
    __tablename__ = "cocktail_lot_documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cocktail_lot_id = Column(UUID(as_uuid=True), ForeignKey("cocktail_lots.id"), nullable=False)
    lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_size = Column(BigInteger, nullable=True)
    content_type = Column(String(100), nullable=True)
    checksum_sha256 = Column(String(64), nullable=True)
    description = Column(String(500), nullable=True)
    is_qc_document = Column(Boolean, default=False, nullable=False, server_default="false")
    renewal_number = Column(Integer, nullable=False, server_default="0")
    storage_class = Column(String(20), nullable=True, server_default="hot")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_deleted = Column(Boolean, default=False, nullable=False, server_default="false")
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    cocktail_lot = relationship("CocktailLot", back_populates="documents")
    user = relationship("User", foreign_keys=[user_id])


# ── Shared Vendor Catalog ─────────────────────────────────────────────────


class VendorCatalog(Base):
    """
    Cross-lab shared catalog of vendor products.

    This table is NOT scoped by lab_id - it's a shared resource that learns
    product info from all labs. When a lab registers a lot with a barcode,
    the product info is upserted here so future scans can auto-populate.

    Key design decisions:
    - UNIQUE(vendor, catalog_number) - composite key for uniqueness
    - use_count tracks agreements (labs that used data as-is)
    - conflict_count tracks disagreements (labs that entered different data)
    - Normalized columns enable fuzzy matching across formatting differences
    """
    __tablename__ = "vendor_catalog"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Composite unique constraint: same catalog # can exist for different vendors
    vendor = Column(String(255), nullable=False)
    catalog_number = Column(String(50), nullable=False)

    # Product attributes
    designation = Column(String(10))  # "asr", "ruo", "ivd"

    # For RUO/ASR products
    target = Column(String(100))  # Display: "CD-45"
    target_normalized = Column(String(100))  # Match: "CD45"
    fluorochrome = Column(String(100))  # Display: "APC-R700"
    fluorochrome_normalized = Column(String(100))  # Match: "APCR700"
    clone = Column(String(100))

    # For IVD products
    product_name = Column(String(255))  # Display name
    product_name_normalized = Column(String(255))  # Match value

    # Confidence tracking
    use_count = Column(Integer, default=1, nullable=False)  # Labs that AGREED
    conflict_count = Column(Integer, default=0, nullable=False)  # Labs that DISAGREED
    first_seen_at = Column(DateTime(timezone=True), server_default=func.now())
    last_used_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_lab_id = Column(UUID(as_uuid=True), ForeignKey("labs.id"), nullable=True)

    __table_args__ = (
        UniqueConstraint('vendor', 'catalog_number', name='uq_vendor_catalog'),
        Index('idx_vendor_catalog_normalized', 'target_normalized', 'fluorochrome_normalized'),
    )
