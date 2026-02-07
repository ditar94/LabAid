"""add lot_requests table

Revision ID: e0f1a2b3c4d5
Revises: d3e4f5a6b7c8
Create Date: 2026-02-07 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'e0f1a2b3c4d5'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'lot_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('lab_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('labs.id'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('barcode', sa.String(255), nullable=False),
        sa.Column('lot_number', sa.String(100), nullable=True),
        sa.Column('expiration_date', sa.Date(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('storage_unit_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('storage_units.id'), nullable=True),
        sa.Column('gs1_ai', sa.JSON(), nullable=True),
        sa.Column('enrichment_data', sa.JSON(), nullable=True),
        sa.Column('proposed_antibody', sa.JSON(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.Enum('pending', 'approved', 'rejected', name='lotrequestatus'), nullable=False, server_default='pending'),
        sa.Column('reviewed_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('rejection_note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('lot_requests')
    op.execute("DROP TYPE IF EXISTS lotrequestatus")
