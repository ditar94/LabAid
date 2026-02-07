"""add reagent_components table

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-02-06 14:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'reagent_components',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('antibody_id', UUID(as_uuid=True), sa.ForeignKey('antibodies.id', ondelete='CASCADE'), nullable=False),
        sa.Column('target', sa.String(100), nullable=False),
        sa.Column('fluorochrome', sa.String(100), nullable=False),
        sa.Column('clone', sa.String(100), nullable=True),
        sa.Column('ordinal', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_index('ix_reagent_components_antibody_id', 'reagent_components', ['antibody_id'])


def downgrade() -> None:
    op.drop_index('ix_reagent_components_antibody_id', table_name='reagent_components')
    op.drop_table('reagent_components')
