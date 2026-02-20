"""Add renewal_number to cocktail_lot_documents

Revision ID: l6a7b8c9d0e1
Revises: k5f6a7b8c9d0
Create Date: 2026-02-19

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "l6a7b8c9d0e1"
down_revision: Union[str, None] = "k5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "cocktail_lot_documents",
        sa.Column("renewal_number", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("cocktail_lot_documents", "renewal_number")
