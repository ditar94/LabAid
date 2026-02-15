"""Add blob metadata columns to lot_documents

Revision ID: g1b2c3d4e5f6
Revises: f7a8b9c0d1e2
Create Date: 2026-02-14

"""

from alembic import op
import sqlalchemy as sa


revision = "g1b2c3d4e5f6"
down_revision = "f7a8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("lot_documents", sa.Column("file_size", sa.BigInteger(), nullable=True))
    op.add_column("lot_documents", sa.Column("content_type", sa.String(100), nullable=True))
    op.add_column("lot_documents", sa.Column("checksum_sha256", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("lot_documents", "checksum_sha256")
    op.drop_column("lot_documents", "content_type")
    op.drop_column("lot_documents", "file_size")
