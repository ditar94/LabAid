"""add storage_class to lot_documents

Revision ID: f4a5b6c7d8e9
Revises: e0f1a2b3c4d5
Create Date: 2026-02-07 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, None] = 'e0f1a2b3c4d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'lot_documents',
        sa.Column('storage_class', sa.String(20), nullable=True, server_default='hot'),
    )


def downgrade() -> None:
    op.drop_column('lot_documents', 'storage_class')
