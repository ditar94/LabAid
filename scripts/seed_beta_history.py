#!/usr/bin/env python3
"""
Seed 2 years of realistic historical data for Test Lab A in beta.

Creates 3 antibody-fluorochrome combos (CD45 FITC, CD19 BV786, CD34 APC-R700)
with staggered creation dates, multiple lot cycles per antibody, QC docs,
and realistic vial open/deplete patterns over ~24 months.

Prerequisites:
  1. Cloud SQL Auth Proxy running:
       cloud-sql-proxy labaid-prod:us-central1:labaid-db-nonprod --port=5433

  2. Run with DATABASE_URL pointing to the beta database:
       DATABASE_URL="postgresql://labaid_migrate:<password>@127.0.0.1:5433/labaid" \\
         python3 scripts/seed_beta_history.py

  3. To undo all seed data:
       DATABASE_URL="..." python3 scripts/seed_beta_history.py --rollback
"""

import json
import os
import random
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Optional
from uuid import uuid4

# Reproducible randomness
random.seed(2026_02_16)

# ── Reference date ──────────────────────────────────────────────────────────
NOW = datetime(2026, 2, 16, 17, 0, 0, tzinfo=timezone.utc)

# ── Antibody / Lot definitions ──────────────────────────────────────────────
# first_use is computed dynamically per lot to enforce FEFO (don't use new lot
# until old lot is fully depleted).

ANTIBODIES = [
    {
        "target": "CD45",
        "fluorochrome": "FITC",
        "fluoro_color": "#3cb44b",
        "clone": "HI30",
        "vendor": "Sysmex",
        "catalog_number": "21-F45-100",
        "stability_days": 90,
        "low_stock_threshold": 3,
        "approved_low_threshold": 2,
        "created_at": datetime(2024, 2, 15, 14, 32, 0, tzinfo=timezone.utc),
        "lots": [
            {
                "lot_number": "SX24-02891",
                "expiration_date": date(2024, 11, 30),
                "created_at": datetime(2024, 2, 16, 10, 15, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2024, 2, 18, 9, 33, 0, tzinfo=timezone.utc),
                "vial_count": 10,
                "avg_interval_days": 26,
                "interval_jitter": 4,
            },
            {
                "lot_number": "SX24-11456",
                "expiration_date": date(2025, 8, 31),
                "created_at": datetime(2024, 11, 23, 11, 5, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2024, 11, 25, 14, 22, 0, tzinfo=timezone.utc),
                "vial_count": 10,
                "avg_interval_days": 26,
                "interval_jitter": 4,
            },
            {
                "lot_number": "SX25-08233",
                "expiration_date": date(2026, 5, 31),
                "created_at": datetime(2025, 8, 24, 10, 48, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2025, 8, 26, 13, 17, 0, tzinfo=timezone.utc),
                "vial_count": 12,
                "avg_interval_days": 26,
                "interval_jitter": 4,
            },
        ],
    },
    {
        "target": "CD19",
        "fluorochrome": "BV786",
        "fluoro_color": "#dcbeff",
        "clone": "SJ25C1",
        "vendor": "Becton Dickinson",
        "catalog_number": "740968",
        "stability_days": 60,
        "low_stock_threshold": 2,
        "approved_low_threshold": 1,
        "created_at": datetime(2024, 4, 10, 15, 5, 0, tzinfo=timezone.utc),
        "lots": [
            {
                "lot_number": "4085612",
                "expiration_date": date(2025, 1, 15),
                "created_at": datetime(2024, 4, 12, 9, 22, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2024, 4, 14, 11, 48, 0, tzinfo=timezone.utc),
                "vial_count": 8,
                "avg_interval_days": 32,
                "interval_jitter": 5,
            },
            {
                "lot_number": "4112890",
                "expiration_date": date(2025, 10, 15),
                "created_at": datetime(2025, 1, 8, 14, 33, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2025, 1, 10, 10, 18, 0, tzinfo=timezone.utc),
                "vial_count": 8,
                "avg_interval_days": 32,
                "interval_jitter": 5,
            },
            {
                "lot_number": "4156234",
                "expiration_date": date(2026, 7, 15),
                "created_at": datetime(2025, 10, 8, 11, 2, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2025, 10, 10, 15, 35, 0, tzinfo=timezone.utc),
                "vial_count": 10,
                "avg_interval_days": 32,
                "interval_jitter": 5,
            },
        ],
    },
    {
        "target": "CD34",
        "fluorochrome": "APC-R700",
        "fluoro_color": "#e6194b",
        "clone": "581",
        "vendor": "Becton Dickinson",
        "catalog_number": "747823",
        "stability_days": 120,
        "low_stock_threshold": 2,
        "approved_low_threshold": 1,
        "created_at": datetime(2024, 7, 1, 10, 12, 0, tzinfo=timezone.utc),
        "lots": [
            {
                "lot_number": "3098456",
                "expiration_date": date(2025, 4, 1),
                "created_at": datetime(2024, 7, 3, 13, 47, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2024, 7, 5, 9, 35, 0, tzinfo=timezone.utc),
                "vial_count": 6,
                "avg_interval_days": 40,
                "interval_jitter": 6,
            },
            {
                "lot_number": "3145789",
                "expiration_date": date(2025, 12, 20),
                "created_at": datetime(2025, 3, 25, 10, 33, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2025, 3, 27, 14, 5, 0, tzinfo=timezone.utc),
                "vial_count": 6,
                "avg_interval_days": 40,
                "interval_jitter": 6,
            },
            {
                "lot_number": "3178902",
                "expiration_date": date(2026, 9, 15),
                "created_at": datetime(2025, 12, 13, 15, 5, 0, tzinfo=timezone.utc),
                "approved_at": datetime(2025, 12, 15, 10, 48, 0, tzinfo=timezone.utc),
                "vial_count": 8,
                "avg_interval_days": 40,
                "interval_jitter": 6,
            },
        ],
    },
]

# Tag for rollback identification
SEED_TAG = "seed:beta-history-2026"


# ── Helpers ─────────────────────────────────────────────────────────────────


def ts(dt: datetime) -> str:
    """Format datetime for SQL."""
    return dt.strftime("%Y-%m-%d %H:%M:%S+00")


def d(dt: date) -> str:
    """Format date for SQL."""
    return dt.strftime("%Y-%m-%d")


def jdump(obj: dict) -> str:
    """JSON-encode for SQL TEXT column."""
    return json.dumps(obj, default=str)


def work_hour(dt: datetime) -> datetime:
    """Clamp to realistic work hours (7-17 UTC, i.e. ~morning shift US)."""
    return dt.replace(
        hour=random.randint(7, 16),
        minute=random.randint(0, 59),
        second=random.randint(0, 59),
    )


def generate_vial_timeline(
    first_use: datetime,
    vial_count: int,
    avg_interval_days: int,
    interval_jitter: int,
    stability_days: Optional[int],
    expiration_date: date,
) -> List[dict]:
    """Generate open/deplete schedule for each vial in a lot.

    Enforces: no vial is OPENED after the lot expiration date.
    Returns list of dicts with status, timestamps, and user indices.
    Also returns the datetime the last vial was depleted (for FEFO chaining).
    """
    vials = []
    cursor = first_use
    lot_expiry_dt = datetime(
        expiration_date.year, expiration_date.month, expiration_date.day,
        17, 0, 0, tzinfo=timezone.utc,
    )

    for i in range(vial_count):
        # Don't open past lot expiry or past NOW
        if cursor >= NOW or cursor >= lot_expiry_dt:
            vials.append({
                "status": "sealed",
                "opened_at": None, "opened_by_idx": None,
                "depleted_at": None, "depleted_by_idx": None,
                "open_expiration": None,
            })
            cursor += timedelta(days=avg_interval_days)
            continue

        open_time = work_hour(cursor)

        # Stability-based open_expiration
        stab_exp = (open_time.date() + timedelta(days=stability_days)) if stability_days else None
        open_exp = min(stab_exp, expiration_date) if stab_exp else expiration_date

        # How long this vial is used before depletion
        use_days = avg_interval_days + random.randint(-interval_jitter, interval_jitter)
        use_days = max(use_days, 7)

        deplete_time = work_hour(open_time + timedelta(days=use_days))

        open_user = random.choice([0, 1])
        deplete_user = random.choice([0, 1])

        if deplete_time >= NOW:
            # Currently in use
            vials.append({
                "status": "opened",
                "opened_at": open_time, "opened_by_idx": open_user,
                "depleted_at": None, "depleted_by_idx": None,
                "open_expiration": open_exp,
            })
            cursor = deplete_time + timedelta(days=random.randint(0, 1))
        else:
            vials.append({
                "status": "depleted",
                "opened_at": open_time, "opened_by_idx": open_user,
                "depleted_at": deplete_time, "depleted_by_idx": deplete_user,
                "open_expiration": open_exp,
            })
            # Next vial opens shortly after this one is depleted
            cursor = deplete_time + timedelta(days=random.randint(0, 2))

    return vials


def last_depletion(vials: List[dict]) -> Optional[datetime]:
    """Return the datetime of the last depleted vial, or None."""
    depleted = [v["depleted_at"] for v in vials if v["depleted_at"]]
    return max(depleted) if depleted else None


# ── Main ────────────────────────────────────────────────────────────────────


def main():
    import psycopg2

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        # Fall back to individual env vars for passwords with special characters
        db_host = os.environ.get("DB_HOST", "127.0.0.1")
        db_port = os.environ.get("DB_PORT", "5433")
        db_name = os.environ.get("DB_NAME", "labaid_beta")
        db_user = os.environ.get("DB_USER", "labaid_migrate")
        db_pass = os.environ.get("DB_PASSWORD")
        if not db_pass:
            print("ERROR: Set DATABASE_URL or DB_PASSWORD environment variable.")
            sys.exit(1)
    else:
        db_host = db_port = db_name = db_user = db_pass = None  # unused

    rollback = "--rollback" in sys.argv
    dry_run = "--dry-run" in sys.argv

    if db_url:
        conn = psycopg2.connect(db_url)
    else:
        conn = psycopg2.connect(host=db_host, port=int(db_port), dbname=db_name,
                                user=db_user, password=db_pass)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        if rollback:
            do_rollback(cur)
            conn.commit()
            print("Rollback complete.")
            return

        do_seed(cur)
        if dry_run:
            conn.rollback()
            print("\n(DRY RUN — no data committed)")
        else:
            conn.commit()
            print("\nSeed complete! All data committed.")
    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


def do_rollback(cur):
    """Remove all seed data by finding audit logs tagged with SEED_TAG."""
    print(f"Rolling back seed data tagged '{SEED_TAG}'...")

    # Collect all seeded entity IDs from audit log
    cur.execute("SELECT entity_type, entity_id FROM audit_log WHERE note = %s", (SEED_TAG,))
    rows = cur.fetchall()

    entity_ids = {
        "antibody": set(), "lot": set(), "vial": set(),
        "lot_document": set(), "fluorochrome": set(), "storage_unit": set(),
    }
    for etype, eid in rows:
        if etype in entity_ids:
            entity_ids[etype].add(eid)

    # Delete in reverse dependency order
    if entity_ids["vial"]:
        cur.execute("DELETE FROM vials WHERE id IN %s", (tuple(entity_ids["vial"]),))
        print(f"  Deleted {cur.rowcount} vials")

    if entity_ids["lot_document"]:
        cur.execute("DELETE FROM lot_documents WHERE id IN %s", (tuple(entity_ids["lot_document"]),))
        print(f"  Deleted {cur.rowcount} lot_documents")

    if entity_ids["lot"]:
        cur.execute("DELETE FROM lots WHERE id IN %s", (tuple(entity_ids["lot"]),))
        print(f"  Deleted {cur.rowcount} lots")

    if entity_ids["antibody"]:
        ids = tuple(entity_ids["antibody"])
        cur.execute("DELETE FROM reagent_components WHERE antibody_id IN %s", (ids,))
        cur.execute("DELETE FROM antibodies WHERE id IN %s", (ids,))
        print(f"  Deleted {cur.rowcount} antibodies")

    if entity_ids["fluorochrome"]:
        cur.execute("DELETE FROM fluorochromes WHERE id IN %s", (tuple(entity_ids["fluorochrome"]),))
        print(f"  Deleted {cur.rowcount} fluorochromes")

    # Delete all tagged audit log entries
    cur.execute("DELETE FROM audit_log WHERE note = %s", (SEED_TAG,))
    print(f"  Deleted {cur.rowcount} audit_log entries")


def do_seed(cur):
    """Insert all seed data."""

    # ── 1. Discover Test Lab A ──────────────────────────────────────────

    cur.execute("SELECT id, name, settings FROM labs WHERE name ILIKE '%%test lab%%' AND is_active = true")
    lab_rows = cur.fetchall()
    if not lab_rows:
        cur.execute("SELECT id, name FROM labs WHERE is_active = true ORDER BY created_at")
        all_labs = cur.fetchall()
        print("Could not find a lab matching 'Test Lab'. Available labs:")
        for lid, lname in all_labs:
            print(f"  {lid}  {lname}")
        sys.exit(1)

    if len(lab_rows) > 1:
        print("Multiple labs match 'Test Lab':")
        for i, (lid, lname, _) in enumerate(lab_rows):
            print(f"  [{i}] {lname} ({lid})")
        choice = input("Enter number: ")
        lab_row = lab_rows[int(choice)]
    else:
        lab_row = lab_rows[0]

    lab_id = lab_row[0]
    lab_name = lab_row[1]
    print(f"Lab: {lab_name} ({lab_id})")

    # ── 2. Discover users ───────────────────────────────────────────────

    cur.execute(
        "SELECT id, full_name, role FROM users WHERE lab_id = %s AND is_active = true ORDER BY created_at",
        (lab_id,),
    )
    users = cur.fetchall()
    if len(users) < 2:
        print(f"Expected at least 2 active users in {lab_name}, found {len(users)}")
        for uid, uname, urole in users:
            print(f"  {uid} {uname} ({urole})")
        sys.exit(1)

    users = users[:2]
    user_ids = [u[0] for u in users]
    user_names = [u[1] for u in users]
    user_roles = [u[2] for u in users]
    print(f"User 1: {user_names[0]} ({user_roles[0]})")
    print(f"User 2: {user_names[1]} ({user_roles[1]})")

    # Pick admin user (higher role for approvals, antibody creation)
    role_rank = {"lab_admin": 3, "supervisor": 2, "tech": 1, "read_only": 0}
    admin_idx = 0 if role_rank.get(user_roles[0], 0) >= role_rank.get(user_roles[1], 0) else 1
    admin_user_id = user_ids[admin_idx]
    print(f"Admin user (approvals): {user_names[admin_idx]}")

    # ── 3. Check for existing seed data ─────────────────────────────────

    cur.execute("SELECT COUNT(*) FROM audit_log WHERE note = %s", (SEED_TAG,))
    existing = cur.fetchone()[0]
    if existing > 0:
        print(f"\nWARNING: Found {existing} existing seed entries.")
        print("Run with --rollback first to clean up.")
        resp = input("Continue and add MORE seed data? [y/N] ")
        if resp.lower() != "y":
            sys.exit(0)

    # ── 4. Find or create temp storage ──────────────────────────────────

    cur.execute(
        "SELECT id FROM storage_units WHERE lab_id = %s AND is_temporary = true AND is_active = true",
        (lab_id,),
    )
    temp_row = cur.fetchone()
    if temp_row:
        temp_unit_id = temp_row[0]
        print(f"Temp storage: {temp_unit_id}")
    else:
        temp_unit_id = uuid4()
        ts_early = datetime(2024, 2, 15, 14, 0, 0, tzinfo=timezone.utc)
        cur.execute(
            """INSERT INTO storage_units (id, lab_id, name, rows, cols, temperature, is_active, is_temporary, created_at)
               VALUES (%s, %s, 'Temporary Storage', 26, 26, NULL, true, true, %s)""",
            (str(temp_unit_id), str(lab_id), ts(ts_early)),
        )
        _audit(cur, lab_id, admin_user_id, "storage_unit.created", "storage_unit", temp_unit_id,
               after_state={"name": "Temporary Storage", "is_temporary": True},
               created_at=ts_early)
        print(f"Created temp storage: {temp_unit_id}")

    # Load existing cells
    cur.execute(
        "SELECT id, row, col FROM storage_cells WHERE storage_unit_id = %s ORDER BY row, col",
        (str(temp_unit_id),),
    )
    existing_cells = {(r, c): cid for cid, r, c in cur.fetchall()}
    print(f"Existing temp cells: {len(existing_cells)}")

    def get_or_create_cell(row, col):
        key = (row, col)
        if key in existing_cells:
            return existing_cells[key]
        cell_id = uuid4()
        label = f"{chr(65 + row)}{col + 1}"
        cur.execute(
            "INSERT INTO storage_cells (id, storage_unit_id, row, col, label) VALUES (%s, %s, %s, %s, %s)",
            (str(cell_id), str(temp_unit_id), row, col, label),
        )
        existing_cells[key] = cell_id
        return cell_id

    cell_counter = [0]

    def allocate_cell():
        idx = cell_counter[0]
        cell_counter[0] += 1
        return get_or_create_cell(idx // 26, idx % 26)

    # ── 5. Fluorochromes ────────────────────────────────────────────────

    for ab_cfg in ANTIBODIES:
        fname = ab_cfg["fluorochrome"]
        cur.execute("SELECT id FROM fluorochromes WHERE lab_id = %s AND name = %s", (str(lab_id), fname))
        row = cur.fetchone()
        if row:
            print(f"Fluorochrome {fname}: exists")
        else:
            fid = uuid4()
            cur.execute(
                "INSERT INTO fluorochromes (id, lab_id, name, color, is_active) VALUES (%s, %s, %s, %s, true)",
                (str(fid), str(lab_id), fname, ab_cfg["fluoro_color"]),
            )
            _audit(cur, lab_id, admin_user_id, "fluorochrome.created", "fluorochrome", fid,
                   after_state={"name": fname, "color": ab_cfg["fluoro_color"]},
                   created_at=ab_cfg["created_at"] - timedelta(minutes=5))
            print(f"Fluorochrome {fname}: created")

    # ── 6. Antibodies, lots, vials ──────────────────────────────────────

    stats = {"vials": 0, "lots": 0, "audits": 0}

    for ab_cfg in ANTIBODIES:
        ab_id = uuid4()

        cur.execute(
            """INSERT INTO antibodies
               (id, lab_id, target, fluorochrome, clone, vendor, catalog_number,
                designation, stability_days, low_stock_threshold, approved_low_threshold,
                is_active, created_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,'ruo',%s,%s,%s,true,%s)""",
            (str(ab_id), str(lab_id), ab_cfg["target"], ab_cfg["fluorochrome"],
             ab_cfg["clone"], ab_cfg["vendor"], ab_cfg["catalog_number"],
             ab_cfg["stability_days"], ab_cfg["low_stock_threshold"],
             ab_cfg["approved_low_threshold"], ts(ab_cfg["created_at"])),
        )

        _audit(cur, lab_id, admin_user_id, "antibody.created", "antibody", ab_id,
               after_state={
                   "target": ab_cfg["target"], "fluorochrome": ab_cfg["fluorochrome"],
                   "clone": ab_cfg["clone"], "vendor": ab_cfg["vendor"],
                   "catalog_number": ab_cfg["catalog_number"], "designation": "ruo",
                   "stability_days": ab_cfg["stability_days"], "is_active": True,
               },
               created_at=ab_cfg["created_at"])
        stats["audits"] += 1

        print(f"\n{'─'*60}")
        print(f"Antibody: {ab_cfg['target']} {ab_cfg['fluorochrome']} "
              f"({ab_cfg['vendor']}, cat# {ab_cfg['catalog_number']})")

        # ── Chain lots with FEFO ────────────────────────────────────────

        prev_lot_depleted_at = None  # Track when previous lot was fully done

        for lot_idx, lot_cfg in enumerate(ab_cfg["lots"]):
            lot_id = uuid4()
            lot_created = lot_cfg["created_at"]
            lot_approved = lot_cfg["approved_at"]

            # Compute first_use: FEFO — can't use until previous lot is depleted
            # AND lot must be approved first
            earliest_use = lot_approved + timedelta(
                hours=random.randint(1, 18),
                minutes=random.randint(0, 59),
            )
            if prev_lot_depleted_at and prev_lot_depleted_at > earliest_use:
                # Previous lot still had vials — wait for it
                earliest_use = prev_lot_depleted_at + timedelta(
                    days=random.randint(0, 2),
                    hours=random.randint(1, 8),
                )
            first_use = work_hour(earliest_use)

            # ── Insert lot ──────────────────────────────────────────────

            cur.execute(
                """INSERT INTO lots
                   (id, antibody_id, lab_id, lot_number, vendor_barcode,
                    expiration_date, qc_status, qc_approved_by, qc_approved_at,
                    is_archived, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,'approved',%s,%s,false,%s)""",
                (str(lot_id), str(ab_id), str(lab_id),
                 lot_cfg["lot_number"], lot_cfg["lot_number"],
                 d(lot_cfg["expiration_date"]),
                 str(admin_user_id), ts(lot_approved), ts(lot_created)),
            )
            stats["lots"] += 1

            # Audit: lot.created
            _audit(cur, lab_id, admin_user_id, "lot.created", "lot", lot_id,
                   after_state={
                       "lot_number": lot_cfg["lot_number"],
                       "qc_status": "pending", "is_archived": False,
                   },
                   created_at=lot_created)
            stats["audits"] += 1

            # ── QC document ─────────────────────────────────────────────

            doc_id = uuid4()
            doc_time = lot_approved - timedelta(
                hours=random.randint(1, 6),
                minutes=random.randint(0, 59),
            )
            doc_filename = f"QC_Certificate_{lot_cfg['lot_number']}.pdf"
            fake_checksum = "".join(random.choices("0123456789abcdef", k=64))
            fake_path = f"labs/{lab_id}/lots/{lot_id}/documents/{doc_id}/{doc_filename}"

            cur.execute(
                """INSERT INTO lot_documents
                   (id, lot_id, lab_id, user_id, file_path, file_name, file_size,
                    content_type, checksum_sha256, description, is_qc_document,
                    storage_class, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true,'hot',%s)""",
                (str(doc_id), str(lot_id), str(lab_id), str(admin_user_id),
                 fake_path, doc_filename, random.randint(45000, 250000),
                 "application/pdf", fake_checksum,
                 f"QC Certificate — {lot_cfg['lot_number']}",
                 ts(doc_time)),
            )

            _audit(cur, lab_id, admin_user_id, "document.uploaded", "lot_document", doc_id,
                   after_state={
                       "lot_id": str(lot_id), "file_name": doc_filename,
                       "is_qc_document": True,
                   },
                   created_at=doc_time)
            stats["audits"] += 1

            # Audit: lot.qc_approved
            _audit(cur, lab_id, admin_user_id, "lot.qc_approved", "lot", lot_id,
                   before_state={"lot_number": lot_cfg["lot_number"], "qc_status": "pending"},
                   after_state={
                       "lot_number": lot_cfg["lot_number"], "qc_status": "approved",
                       "qc_approved_by": str(admin_user_id),
                   },
                   created_at=lot_approved)
            stats["audits"] += 1

            # ── Generate vial timeline ──────────────────────────────────

            vials = generate_vial_timeline(
                first_use=first_use,
                vial_count=lot_cfg["vial_count"],
                avg_interval_days=lot_cfg["avg_interval_days"],
                interval_jitter=lot_cfg["interval_jitter"],
                stability_days=ab_cfg["stability_days"],
                expiration_date=lot_cfg["expiration_date"],
            )

            n_sealed = sum(1 for v in vials if v["status"] == "sealed")
            n_opened = sum(1 for v in vials if v["status"] == "opened")
            n_depleted = sum(1 for v in vials if v["status"] == "depleted")
            ld = last_depletion(vials)

            print(f"  Lot {lot_cfg['lot_number']:12s}  exp {lot_cfg['expiration_date']}  "
                  f"{len(vials)} vials: {n_sealed}S {n_opened}O {n_depleted}D  "
                  f"first_use: {first_use.date()}  "
                  f"last_deplete: {ld.date() if ld else 'n/a'}")

            # Update chain for FEFO
            prev_lot_depleted_at = ld

            # ── Insert vials ────────────────────────────────────────────

            vial_ids = []
            for v in vials:
                vial_id = uuid4()
                vial_ids.append(vial_id)

                # Sealed/opened vials sit in temp storage; depleted vials have no cell
                cell_id = None
                if v["status"] in ("sealed", "opened"):
                    cell_id = allocate_cell()

                opened_by = str(user_ids[v["opened_by_idx"]]) if v["opened_by_idx"] is not None else None
                depleted_by = str(user_ids[v["depleted_by_idx"]]) if v["depleted_by_idx"] is not None else None

                cur.execute(
                    """INSERT INTO vials
                       (id, lot_id, lab_id, status, location_cell_id,
                        received_at, opened_at, opened_by, open_expiration,
                        depleted_at, depleted_by, opened_for_qc)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,false)""",
                    (str(vial_id), str(lot_id), str(lab_id),
                     v["status"],
                     str(cell_id) if cell_id else None,
                     ts(lot_created),  # received_at = when lot was created
                     ts(v["opened_at"]) if v["opened_at"] else None,
                     opened_by,
                     d(v["open_expiration"]) if v["open_expiration"] else None,
                     ts(v["depleted_at"]) if v["depleted_at"] else None,
                     depleted_by),
                )
                stats["vials"] += 1

            # ── Audit: vial.received (one batch entry) ──────────────────

            receive_user = user_ids[random.choice([0, 1])]
            _audit(cur, lab_id, receive_user, "vial.received", "lot", lot_id,
                   after_state={
                       "lot_id": str(lot_id), "lot_number": lot_cfg["lot_number"],
                       "quantity": lot_cfg["vial_count"],
                       "storage": "Temporary Storage",
                   },
                   created_at=lot_created + timedelta(minutes=random.randint(5, 30)))
            stats["audits"] += 1

            # ── Audit: individual vial opens and depletes ───────────────

            for v_idx, v in enumerate(vials):
                vid = vial_ids[v_idx]

                if v["opened_at"]:
                    _audit(cur, lab_id, user_ids[v["opened_by_idx"]],
                           "vial.opened", "vial", vid,
                           before_state={"id": str(vid), "lot_id": str(lot_id), "status": "sealed"},
                           after_state={
                               "id": str(vid), "lot_id": str(lot_id), "status": "opened",
                               "opened_at": str(v["opened_at"]),
                               "opened_by": str(user_ids[v["opened_by_idx"]]),
                           },
                           created_at=v["opened_at"])
                    stats["audits"] += 1

                if v["depleted_at"]:
                    _audit(cur, lab_id, user_ids[v["depleted_by_idx"]],
                           "vial.depleted", "vial", vid,
                           before_state={
                               "id": str(vid), "lot_id": str(lot_id), "status": "opened",
                               "opened_at": str(v["opened_at"]),
                           },
                           after_state={
                               "id": str(vid), "lot_id": str(lot_id), "status": "depleted",
                               "depleted_at": str(v["depleted_at"]),
                               "depleted_by": str(user_ids[v["depleted_by_idx"]]),
                           },
                           created_at=v["depleted_at"])
                    stats["audits"] += 1

    # ── Summary ─────────────────────────────────────────────────────────

    print(f"\n{'='*60}")
    print(f"SUMMARY")
    print(f"  Antibodies:  {len(ANTIBODIES)}")
    print(f"  Lots:        {stats['lots']}")
    print(f"  Vials:       {stats['vials']}")
    print(f"  Audit logs:  {stats['audits']}")
    print(f"  Seed tag:    {SEED_TAG}")
    print(f"{'='*60}")


def _audit(cur, lab_id, user_id, action, entity_type, entity_id,
           before_state=None, after_state=None, note=None, created_at=None):
    """Insert audit log entry with explicit timestamp and seed tag in note."""
    cur.execute(
        """INSERT INTO audit_log
           (id, lab_id, user_id, action, entity_type, entity_id,
            before_state, after_state, note, is_support_action, created_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,false,%s)""",
        (str(uuid4()), str(lab_id), str(user_id), action, entity_type, str(entity_id),
         jdump(before_state) if before_state else None,
         jdump(after_state) if after_state else None,
         note or SEED_TAG,
         ts(created_at) if created_at else ts(NOW)),
    )


if __name__ == "__main__":
    main()
