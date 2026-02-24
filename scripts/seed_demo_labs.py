#!/usr/bin/env python3
"""
Provision demo labs for the self-service demo system.

Prerequisites:
  1. Cloud SQL Auth Proxy running (for remote databases):
       cloud-sql-proxy labaid-prod:us-central1:labaid-db-nonprod --port=5433

  2. Run with DATABASE_URL pointing to the target database:
       DATABASE_URL="postgresql://labaid_migrate:<password>@127.0.0.1:5433/labaid" \
         python3 scripts/seed_demo_labs.py --count 5

  3. To delete all demo labs and their data:
       DATABASE_URL="..." python3 scripts/seed_demo_labs.py --rollback

  4. For local dev (Docker Compose):
       DATABASE_URL="postgresql://labaid:labaid@localhost:5433/labaid" \
         python3 scripts/seed_demo_labs.py --count 5
"""

import os
import sys

# Add backend to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.core.security import hash_password, generate_temp_password
from app.models.models import Lab, User, UserRole
from app.services.demo_service import seed_demo_lab, wipe_demo_lab

DEMO_USER_EMAIL_PATTERN = "demo-{}@demo.labaid.io"


def provision(session: Session, count: int) -> None:
    existing_count = session.query(Lab).filter(Lab.is_demo.is_(True)).count()
    print(f"Existing demo labs: {existing_count}")

    for i in range(count):
        n = existing_count + i + 1
        lab = Lab(
            name=f"Demo Lab {n}",
            is_active=True,
            is_demo=True,
            demo_status="available",
            settings={"storage_enabled": True, "setup_complete": True},
        )
        session.add(lab)
        session.flush()

        demo_user = User(
            lab_id=lab.id,
            email=DEMO_USER_EMAIL_PATTERN.format(n),
            hashed_password=hash_password(generate_temp_password()),
            full_name="Demo User",
            role=UserRole.LAB_ADMIN,
            is_active=False,
        )
        session.add(demo_user)
        session.flush()

        print(f"  Created {lab.name} (user: {demo_user.email})")
        seed_demo_lab(session, lab, demo_user)
        print(f"  Seeded demo data for {lab.name}")

    print(f"\nProvisioned {count} demo lab(s).")


def rollback(session: Session) -> None:
    demo_labs = session.query(Lab).filter(Lab.is_demo.is_(True)).all()
    if not demo_labs:
        print("No demo labs found.")
        return

    print(f"Found {len(demo_labs)} demo lab(s) to delete.")
    for lab in demo_labs:
        print(f"  Wiping {lab.name}...")
        wipe_demo_lab(session, lab)

        # Delete the demo user
        session.execute(
            text("DELETE FROM users WHERE lab_id = :id"),
            {"id": str(lab.id)},
        )

        # Delete demo leads for this lab
        session.execute(
            text("DELETE FROM demo_leads WHERE demo_lab_id = :id"),
            {"id": str(lab.id)},
        )

        # Delete the lab itself
        session.delete(lab)
        session.flush()
        print(f"  Deleted {lab.name}")

    print(f"\nRolled back {len(demo_labs)} demo lab(s).")


def main():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: Set DATABASE_URL environment variable.")
        print("  Example: DATABASE_URL='postgresql://labaid:labaid@localhost:5433/labaid'")
        sys.exit(1)

    count = 5
    do_rollback = "--rollback" in sys.argv
    dry_run = "--dry-run" in sys.argv

    for arg in sys.argv[1:]:
        if arg.startswith("--count="):
            count = int(arg.split("=")[1])
        elif arg.startswith("--count"):
            idx = sys.argv.index(arg)
            if idx + 1 < len(sys.argv):
                count = int(sys.argv[idx + 1])

    if count < 1 or count > 20:
        print("ERROR: Count must be between 1 and 20.")
        sys.exit(1)

    engine = create_engine(db_url)
    session = Session(engine)

    try:
        if do_rollback:
            rollback(session)
        else:
            provision(session, count)

        if dry_run:
            session.rollback()
            print("\n(DRY RUN — no data committed)")
        else:
            session.commit()
            print("\nDone.")
    except Exception as e:
        session.rollback()
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()
        engine.dispose()


if __name__ == "__main__":
    main()
