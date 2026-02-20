"""Cocktail free text components

Revision ID: k5f6a7b8c9d0
Revises: j4e5f6a7b8c9
Create Date: 2026-02-19

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "k5f6a7b8c9d0"
down_revision: Union[str, None] = "j4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Make antibody_id nullable so components can be free text
    op.alter_column(
        "cocktail_recipe_components",
        "antibody_id",
        existing_type=sa.UUID(as_uuid=True),
        nullable=True,
    )
    # Add free_text_name for non-antibody components (e.g., buffer)
    op.add_column(
        "cocktail_recipe_components",
        sa.Column("free_text_name", sa.String(300), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("cocktail_recipe_components", "free_text_name")
    op.alter_column(
        "cocktail_recipe_components",
        "antibody_id",
        existing_type=sa.UUID(as_uuid=True),
        nullable=False,
    )
