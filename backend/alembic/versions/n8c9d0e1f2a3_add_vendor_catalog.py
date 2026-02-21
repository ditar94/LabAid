"""Add vendor_catalog table for shared cross-lab product data

Revision ID: n8c9d0e1f2a3
Revises: m7b8c9d0e1f2
Create Date: 2026-02-21

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "n8c9d0e1f2a3"
down_revision: Union[str, None] = "m7b8c9d0e1f2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "vendor_catalog",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("vendor", sa.String(255), nullable=False),
        sa.Column("catalog_number", sa.String(50), nullable=False),
        sa.Column("designation", sa.String(10), nullable=True),
        # RUO/ASR fields
        sa.Column("target", sa.String(100), nullable=True),
        sa.Column("target_normalized", sa.String(100), nullable=True),
        sa.Column("fluorochrome", sa.String(100), nullable=True),
        sa.Column("fluorochrome_normalized", sa.String(100), nullable=True),
        sa.Column("clone", sa.String(100), nullable=True),
        # IVD fields
        sa.Column("product_name", sa.String(255), nullable=True),
        sa.Column("product_name_normalized", sa.String(255), nullable=True),
        # Confidence tracking
        sa.Column("use_count", sa.Integer, nullable=False, server_default="1"),
        sa.Column("conflict_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by_lab_id", postgresql.UUID(as_uuid=True), nullable=True),
        # Foreign key
        sa.ForeignKeyConstraint(["created_by_lab_id"], ["labs.id"]),
    )

    # Unique constraint on (vendor, catalog_number)
    op.create_unique_constraint(
        "uq_vendor_catalog",
        "vendor_catalog",
        ["vendor", "catalog_number"],
    )

    # Index for normalized field matching
    op.create_index(
        "idx_vendor_catalog_normalized",
        "vendor_catalog",
        ["target_normalized", "fluorochrome_normalized"],
    )


def downgrade() -> None:
    op.drop_index("idx_vendor_catalog_normalized", table_name="vendor_catalog")
    op.drop_constraint("uq_vendor_catalog", "vendor_catalog", type_="unique")
    op.drop_table("vendor_catalog")
