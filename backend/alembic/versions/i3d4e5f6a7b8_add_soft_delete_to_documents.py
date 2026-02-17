"""Add soft-delete columns to lot_documents

Revision ID: i3d4e5f6a7b8
Revises: h2c3d4e5f6a7
Create Date: 2026-02-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "i3d4e5f6a7b8"
down_revision: Union[str, None] = "h2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "lot_documents",
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "lot_documents",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "lot_documents",
        sa.Column(
            "deleted_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    # Partial index: fast lookup of active docs per lot
    op.create_index(
        "ix_lot_documents_lot_id_not_deleted",
        "lot_documents",
        ["lot_id"],
        postgresql_where=sa.text("is_deleted = false"),
    )


def downgrade() -> None:
    op.drop_index(
        "ix_lot_documents_lot_id_not_deleted",
        table_name="lot_documents",
    )
    op.drop_column("lot_documents", "deleted_by")
    op.drop_column("lot_documents", "deleted_at")
    op.drop_column("lot_documents", "is_deleted")
