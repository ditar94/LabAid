"""Add GTIN key to vendor_catalog, make vendor informational

Revision ID: p0e1f2a3b4c5
Revises: o9d0e1f2a3b4
Create Date: 2026-02-21

Changes:
- Add gtin column (unique, for GS1 barcodes)
- Make vendor nullable (informational only, not part of key)
- Make catalog_number nullable but unique (for vendor-specific formats)
- Drop old composite unique constraint (vendor, catalog_number)
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "p0e1f2a3b4c5"
down_revision: Union[str, None] = "o9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add gtin column
    op.add_column(
        "vendor_catalog",
        sa.Column("gtin", sa.String(14), nullable=True),
    )

    # Create unique index on gtin (partial - only where gtin is not null)
    op.create_index(
        "idx_vendor_catalog_gtin",
        "vendor_catalog",
        ["gtin"],
        unique=True,
        postgresql_where=sa.text("gtin IS NOT NULL"),
    )

    # Drop old composite unique constraint
    op.drop_constraint("uq_vendor_catalog", "vendor_catalog", type_="unique")

    # Make vendor nullable
    op.alter_column(
        "vendor_catalog",
        "vendor",
        existing_type=sa.String(255),
        nullable=True,
    )

    # Make catalog_number nullable
    op.alter_column(
        "vendor_catalog",
        "catalog_number",
        existing_type=sa.String(50),
        nullable=True,
    )

    # Create unique index on catalog_number (partial - only where catalog_number is not null)
    op.create_index(
        "idx_vendor_catalog_catalog_number",
        "vendor_catalog",
        ["catalog_number"],
        unique=True,
        postgresql_where=sa.text("catalog_number IS NOT NULL"),
    )


def downgrade() -> None:
    # Drop new indexes
    op.drop_index("idx_vendor_catalog_catalog_number", table_name="vendor_catalog")
    op.drop_index("idx_vendor_catalog_gtin", table_name="vendor_catalog")

    # Make columns non-nullable again (may fail if nulls exist)
    op.alter_column(
        "vendor_catalog",
        "catalog_number",
        existing_type=sa.String(50),
        nullable=False,
    )
    op.alter_column(
        "vendor_catalog",
        "vendor",
        existing_type=sa.String(255),
        nullable=False,
    )

    # Recreate old composite unique constraint
    op.create_unique_constraint("uq_vendor_catalog", "vendor_catalog", ["vendor", "catalog_number"])

    # Drop gtin column
    op.drop_column("vendor_catalog", "gtin")
