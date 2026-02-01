"""add is testing to antibody

Revision ID: e2c4f6a8b0c1
Revises: 736858e1471b
Create Date: 2026-02-01 19:42:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "e2c4f6a8b0c1"
down_revision: Union[str, None] = "736858e1471b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "antibodies",
        sa.Column("is_testing", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("antibodies", "is_testing")
