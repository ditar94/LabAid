"""Add normalized columns to antibodies for cross-lab matching

Revision ID: o9d0e1f2a3b4
Revises: n8c9d0e1f2a3
Create Date: 2026-02-21

"""
from typing import Sequence, Union

import re
import unicodedata
import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session


revision: str = "o9d0e1f2a3b4"
down_revision: Union[str, None] = "n8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Inline normalization function (matches barcode_parser.normalize_for_matching)
_STRIP_PATTERN = re.compile(r'[\s\-_\.]+')


def normalize_for_matching(value: str | None) -> str | None:
    """Normalize a string for matching: UPPERCASE, strip spaces/hyphens/underscores/periods."""
    if not value:
        return None
    value = unicodedata.normalize('NFKD', value)
    return _STRIP_PATTERN.sub('', value.strip().upper()) or None


def upgrade() -> None:
    # Add normalized columns
    op.add_column(
        "antibodies",
        sa.Column("target_normalized", sa.String(100), nullable=True),
    )
    op.add_column(
        "antibodies",
        sa.Column("fluorochrome_normalized", sa.String(100), nullable=True),
    )
    op.add_column(
        "antibodies",
        sa.Column("name_normalized", sa.String(255), nullable=True),
    )

    # Create index for matching queries
    op.create_index(
        "idx_antibody_normalized",
        "antibodies",
        ["lab_id", "target_normalized", "fluorochrome_normalized"],
    )

    # Backfill existing data
    bind = op.get_bind()
    session = Session(bind=bind)

    # Get all antibodies
    result = session.execute(
        sa.text("SELECT id, target, fluorochrome, name FROM antibodies")
    )

    for row in result:
        ab_id = row[0]
        target = row[1]
        fluorochrome = row[2]
        name = row[3]

        target_norm = normalize_for_matching(target)
        fluoro_norm = normalize_for_matching(fluorochrome)
        name_norm = normalize_for_matching(name)

        session.execute(
            sa.text("""
                UPDATE antibodies
                SET target_normalized = :target_norm,
                    fluorochrome_normalized = :fluoro_norm,
                    name_normalized = :name_norm
                WHERE id = :ab_id
            """),
            {
                "ab_id": ab_id,
                "target_norm": target_norm,
                "fluoro_norm": fluoro_norm,
                "name_norm": name_norm,
            },
        )

    session.commit()


def downgrade() -> None:
    op.drop_index("idx_antibody_normalized", table_name="antibodies")
    op.drop_column("antibodies", "name_normalized")
    op.drop_column("antibodies", "fluorochrome_normalized")
    op.drop_column("antibodies", "target_normalized")
