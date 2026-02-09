"""add approved_low_threshold to antibodies

Revision ID: a5aa756ec411
Revises: 2ada998c37fe
Create Date: 2026-02-02 02:15:18.228824
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a5aa756ec411'
down_revision: Union[str, None] = '2ada998c37fe'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('antibodies', sa.Column('approved_low_threshold', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('antibodies', 'approved_low_threshold')
