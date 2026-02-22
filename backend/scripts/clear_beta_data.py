#!/usr/bin/env python3
"""
Clear beta database data (NOT labs or users).

This script clears:
- Vials
- Lots (and lot_requests)
- Antibodies (and reagent_components)
- Fluorochromes
- Cocktail lots and sources
- Cocktail recipes and components
- Storage cells (vial positions)
- Audit log
- Shared vendor catalog

It does NOT clear:
- Labs
- Users
- Storage units (containers)

Run this against the beta database to reset test data.
"""
from __future__ import annotations

import os
import sys

# Add parent to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text

# Get database URL from environment (must point to beta)
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable not set")
    print("Set it to your beta database connection string")
    sys.exit(1)

# Safety check: don't run against prod
if "labaid-db-prod" in DATABASE_URL or "prod" in DATABASE_URL.lower():
    print("ERROR: This looks like a production database URL!")
    print("This script should only be run against beta/staging databases.")
    sys.exit(1)

def main():
    print("=" * 60)
    print("BETA DATABASE CLEANUP")
    print("=" * 60)
    print(f"\nConnecting to: {DATABASE_URL[:50]}...")

    engine = create_engine(DATABASE_URL)

    with engine.connect() as conn:
        # Get lab count for confirmation
        result = conn.execute(text("SELECT COUNT(*) FROM labs"))
        lab_count = result.scalar()

        result = conn.execute(text("SELECT name FROM labs"))
        lab_names = [row[0] for row in result.fetchall()]

        print(f"\nFound {lab_count} labs:")
        for name in lab_names:
            print(f"  - {name}")

        print("\n" + "=" * 60)
        print("This will DELETE the following data for ALL labs:")
        print("  - Vials")
        print("  - Lots")
        print("  - Lot requests")
        print("  - Antibodies")
        print("  - Reagent components")
        print("  - Fluorochromes")
        print("  - Cocktail lots and sources")
        print("  - Cocktail recipes and components")
        print("  - Storage cell contents (not the units)")
        print("  - Audit log entries")
        print("  - Shared vendor catalog")
        print("\nThis will NOT delete:")
        print("  - Labs")
        print("  - Users")
        print("  - Storage units (containers)")
        print("=" * 60)

        confirm = input("\nType 'DELETE' to confirm: ")
        if confirm != "DELETE":
            print("Aborted.")
            sys.exit(0)

        print("\nClearing data...")

        # Delete in order of dependencies (most dependent first)
        tables = [
            ("vials", "Vials"),
            ("cocktail_lot_sources", "Cocktail lot sources"),
            ("cocktail_lots", "Cocktail lots"),
            ("cocktail_recipe_components", "Cocktail recipe components"),
            ("cocktail_recipes", "Cocktail recipes"),
            ("lots", "Lots"),
            ("lot_requests", "Lot requests"),
            ("reagent_components", "Reagent components"),
            ("antibodies", "Antibodies"),
            ("fluorochromes", "Fluorochromes"),
            ("audit_log", "Audit log"),
            ("vendor_catalog", "Shared vendor catalog"),
        ]

        for table, label in tables:
            try:
                result = conn.execute(text(f"DELETE FROM {table}"))
                print(f"  ✓ {label}: deleted {result.rowcount} rows")
            except Exception as e:
                print(f"  ✗ {label}: {e}")

        # Clear storage cell vial references (but keep cells)
        try:
            result = conn.execute(text("UPDATE storage_cells SET vial_id = NULL"))
            print(f"  ✓ Storage cells: cleared {result.rowcount} vial references")
        except Exception as e:
            print(f"  ✗ Storage cells: {e}")

        conn.commit()

        print("\n" + "=" * 60)
        print("DONE! Beta data has been cleared.")
        print("Labs and users are preserved.")
        print("=" * 60)

if __name__ == "__main__":
    main()
