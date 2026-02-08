"""add billing fields to labs

Revision ID: d5e6f7a8b9c0
Revises: a5b6c7d8e9f0
Create Date: 2026-02-08 10:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'a5b6c7d8e9f0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'labs',
        sa.Column(
            'billing_status',
            sa.String(20),
            nullable=False,
            server_default='trial',
        ),
    )
    op.add_column(
        'labs',
        sa.Column('billing_updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('labs', 'billing_updated_at')
    op.drop_column('labs', 'billing_status')
