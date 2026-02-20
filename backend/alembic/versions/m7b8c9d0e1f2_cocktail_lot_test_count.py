"""Add test_count to cocktail_lots

Revision ID: m7b8c9d0e1f2
Revises: l6a7b8c9d0e1
Create Date: 2026-02-19

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "m7b8c9d0e1f2"
down_revision: Union[str, None] = "l6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cocktail_lots",
        sa.Column("test_count", sa.Integer, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cocktail_lots", "test_count")
