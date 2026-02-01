"""merge heads

Revision ID: 736858e1471b
Revises: cec6ddb3878a, e5f6a7b8c9d0
Create Date: 2026-02-01 18:21:06.488980
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '736858e1471b'
down_revision: Union[str, None] = ('cec6ddb3878a', 'e5f6a7b8c9d0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
