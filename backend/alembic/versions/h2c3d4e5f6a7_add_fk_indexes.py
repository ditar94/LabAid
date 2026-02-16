"""Add indexes on high-traffic foreign key columns

Revision ID: h2c3d4e5f6a7
Revises: g1b2c3d4e5f6
Create Date: 2026-02-15

"""
from typing import Sequence, Union

from alembic import op


revision: str = "h2c3d4e5f6a7"
down_revision: Union[str, None] = "g1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Indexes on frequently-queried FK and filter columns that were missing.
_INDEXES = [
    # lots — queried by lab_id, antibody_id, vendor_barcode on every scan/inventory load
    ("ix_lots_lab_id", "lots", ["lab_id"]),
    ("ix_lots_antibody_id", "lots", ["antibody_id"]),
    ("ix_lots_vendor_barcode", "lots", ["vendor_barcode"]),
    # vials — queried by lot_id, lab_id, status on scan + inventory
    ("ix_vials_lot_id", "vials", ["lot_id"]),
    ("ix_vials_lab_id", "vials", ["lab_id"]),
    ("ix_vials_status", "vials", ["status"]),
    # storage_cells — queried by storage_unit_id on every grid load
    ("ix_storage_cells_unit_id", "storage_cells", ["storage_unit_id"]),
    # lot_documents — queried by lot_id on inventory expand
    ("ix_lot_documents_lot_id", "lot_documents", ["lot_id"]),
    # users — queried by lab_id on users page
    ("ix_users_lab_id", "users", ["lab_id"]),
    # lot_requests — queried by lab_id + status on dashboard badge
    ("ix_lot_requests_lab_id", "lot_requests", ["lab_id"]),
    ("ix_lot_requests_status", "lot_requests", ["status"]),
]


def upgrade() -> None:
    for name, table, columns in _INDEXES:
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in reversed(_INDEXES):
        op.drop_index(name, table_name=table)
