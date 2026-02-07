"""add designation and name to antibodies

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-02-06 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a0b1c2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    designation_enum = sa.Enum('ivd', 'ruo', 'asr', name='designation')
    designation_enum.create(op.get_bind(), checkfirst=True)

    op.add_column(
        'antibodies',
        sa.Column('designation', designation_enum, nullable=False, server_default='ruo'),
    )
    op.add_column(
        'antibodies',
        sa.Column('name', sa.String(300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('antibodies', 'name')
    op.drop_column('antibodies', 'designation')

    designation_enum = sa.Enum('ivd', 'ruo', 'asr', name='designation')
    designation_enum.drop(op.get_bind(), checkfirst=True)
