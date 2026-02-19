"""Add cocktail tracking tables

Revision ID: j4e5f6a7b8c9
Revises: i3d4e5f6a7b8
Create Date: 2026-02-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PG_ENUM


revision: str = "j4e5f6a7b8c9"
down_revision: Union[str, None] = "i3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── cocktail_recipes ──────────────────────────────────────────────────
    op.create_table(
        "cocktail_recipes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("lab_id", sa.UUID(as_uuid=True), sa.ForeignKey("labs.id"), nullable=False),
        sa.Column("name", sa.String(300), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("shelf_life_days", sa.Integer, nullable=False),
        sa.Column("max_renewals", sa.Integer, nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_cocktail_recipes_lab_id", "cocktail_recipes", ["lab_id"])

    # ── cocktail_recipe_components ────────────────────────────────────────
    op.create_table(
        "cocktail_recipe_components",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recipe_id", sa.UUID(as_uuid=True),
            sa.ForeignKey("cocktail_recipes.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("antibody_id", sa.UUID(as_uuid=True), sa.ForeignKey("antibodies.id"), nullable=False),
        sa.Column("volume_ul", sa.Integer, nullable=True),
        sa.Column("ordinal", sa.Integer, nullable=False, server_default="0"),
    )
    op.create_index("ix_cocktail_recipe_components_recipe_id", "cocktail_recipe_components", ["recipe_id"])

    # ── cocktail_lots ─────────────────────────────────────────────────────
    cocktail_lot_status = PG_ENUM("active", "depleted", "archived", name="cocktaillotstatus", create_type=True)
    qc_status = PG_ENUM("pending", "approved", "failed", name="qcstatus", create_type=False)

    op.create_table(
        "cocktail_lots",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("recipe_id", sa.UUID(as_uuid=True), sa.ForeignKey("cocktail_recipes.id"), nullable=False),
        sa.Column("lab_id", sa.UUID(as_uuid=True), sa.ForeignKey("labs.id"), nullable=False),
        sa.Column("lot_number", sa.String(100), nullable=False),
        sa.Column("vendor_barcode", sa.String(255), nullable=True),
        sa.Column("preparation_date", sa.Date, nullable=False),
        sa.Column("expiration_date", sa.Date, nullable=False),
        sa.Column("status", cocktail_lot_status, nullable=False, server_default="active"),
        sa.Column("qc_status", qc_status, nullable=False, server_default="pending"),
        sa.Column("qc_approved_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("qc_approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("renewal_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_renewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location_cell_id", sa.UUID(as_uuid=True), sa.ForeignKey("storage_cells.id"), nullable=True),
        sa.Column("is_archived", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("archive_note", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_cocktail_lots_lab_recipe", "cocktail_lots", ["lab_id", "recipe_id"])
    op.create_index("ix_cocktail_lots_vendor_barcode", "cocktail_lots", ["vendor_barcode"])

    # ── cocktail_lot_sources ──────────────────────────────────────────────
    op.create_table(
        "cocktail_lot_sources",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "cocktail_lot_id", sa.UUID(as_uuid=True),
            sa.ForeignKey("cocktail_lots.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("component_id", sa.UUID(as_uuid=True), sa.ForeignKey("cocktail_recipe_components.id"), nullable=False),
        sa.Column("source_lot_id", sa.UUID(as_uuid=True), sa.ForeignKey("lots.id"), nullable=False),
    )
    op.create_index("ix_cocktail_lot_sources_cocktail_lot_id", "cocktail_lot_sources", ["cocktail_lot_id"])

    # ── cocktail_lot_documents ────────────────────────────────────────────
    op.create_table(
        "cocktail_lot_documents",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("cocktail_lot_id", sa.UUID(as_uuid=True), sa.ForeignKey("cocktail_lots.id"), nullable=False),
        sa.Column("lab_id", sa.UUID(as_uuid=True), sa.ForeignKey("labs.id"), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("file_size", sa.BigInteger, nullable=True),
        sa.Column("content_type", sa.String(100), nullable=True),
        sa.Column("checksum_sha256", sa.String(64), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("is_qc_document", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("storage_class", sa.String(20), nullable=True, server_default="hot"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("is_deleted", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
    )
    op.create_index(
        "ix_cocktail_lot_documents_lot_id_not_deleted",
        "cocktail_lot_documents",
        ["cocktail_lot_id"],
        postgresql_where=sa.text("is_deleted = false"),
    )


def downgrade() -> None:
    op.drop_index("ix_cocktail_lot_documents_lot_id_not_deleted", table_name="cocktail_lot_documents")
    op.drop_table("cocktail_lot_documents")
    op.drop_index("ix_cocktail_lot_sources_cocktail_lot_id", table_name="cocktail_lot_sources")
    op.drop_table("cocktail_lot_sources")
    op.drop_index("ix_cocktail_lots_vendor_barcode", table_name="cocktail_lots")
    op.drop_index("ix_cocktail_lots_lab_recipe", table_name="cocktail_lots")
    op.drop_table("cocktail_lots")
    PG_ENUM(name="cocktaillotstatus").drop(op.get_bind(), checkfirst=True)
    op.drop_index("ix_cocktail_recipe_components_recipe_id", table_name="cocktail_recipe_components")
    op.drop_table("cocktail_recipe_components")
    op.drop_index("ix_cocktail_recipes_lab_id", table_name="cocktail_recipes")
    op.drop_table("cocktail_recipes")
