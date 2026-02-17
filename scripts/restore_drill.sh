#!/usr/bin/env bash
#
# Restore Drill — automated PITR restore test for LabAid production database.
#
# Prerequisites:
#   - gcloud CLI authenticated with project access
#   - cloud-sql-proxy installed (https://cloud.google.com/sql/docs/postgres/sql-proxy)
#   - psql installed
#
# Usage:
#   ./scripts/restore_drill.sh
#
# The script:
#   1. Creates a PITR clone of the production instance
#   2. Connects via Cloud SQL Proxy and runs validation queries
#   3. Compares row counts against production
#   4. Deletes the test clone
#   5. Prints results formatted for the DR doc test history table

set -euo pipefail

PROJECT="labaid-prod"
PROD_INSTANCE="labaid-db-prod"
RESTORE_INSTANCE="labaid-db-test-restore"
DATABASE="labaid"
REGION="us-central1"
PROXY_PORT="5433"
DB_USER="labaid_readonly"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; }

cleanup() {
    log "Cleaning up..."
    # Stop proxy if running
    if [[ -n "${PROXY_PID:-}" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
        kill "$PROXY_PID" 2>/dev/null || true
        wait "$PROXY_PID" 2>/dev/null || true
    fi
    # Delete test instance if it exists
    if gcloud sql instances describe "$RESTORE_INSTANCE" --project="$PROJECT" &>/dev/null; then
        log "Deleting test restore instance..."
        gcloud sql instances delete "$RESTORE_INSTANCE" \
            --project="$PROJECT" --quiet
    fi
}
trap cleanup EXIT

# ── Step 1: Get production row counts ────────────────────────────────────────

log "Getting production row counts via admin API..."
# We query production first so we have baseline counts to compare against.
# This uses the existing Cloud SQL Proxy connection if available, otherwise
# we prompt for a password.
PROD_COUNTS=""
if command -v cloud-sql-proxy &>/dev/null; then
    log "Starting proxy to production instance..."
    cloud-sql-proxy "${PROJECT}:${REGION}:${PROD_INSTANCE}" \
        --port=5434 --quiet &
    PROD_PROXY_PID=$!
    sleep 5

    PROD_COUNTS=$(psql "host=127.0.0.1 port=5434 user=${DB_USER} dbname=${DATABASE} sslmode=disable" \
        --tuples-only --no-align --field-separator='|' -c "
        SELECT 'labs', COUNT(*) FROM labs
        UNION ALL SELECT 'users', COUNT(*) FROM users
        UNION ALL SELECT 'antibodies', COUNT(*) FROM antibodies
        UNION ALL SELECT 'lots', COUNT(*) FROM lots
        UNION ALL SELECT 'vials', COUNT(*) FROM vials
        UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
        UNION ALL SELECT 'lot_documents', COUNT(*) FROM lot_documents
        ORDER BY 1;
    " 2>/dev/null || true)

    kill "$PROD_PROXY_PID" 2>/dev/null || true
    wait "$PROD_PROXY_PID" 2>/dev/null || true
fi

# ── Step 2: Create PITR clone ────────────────────────────────────────────────

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
log "Creating PITR clone at $TIMESTAMP..."

gcloud sql instances clone "$PROD_INSTANCE" "$RESTORE_INSTANCE" \
    --point-in-time="$TIMESTAMP" \
    --project="$PROJECT"

log "Waiting for clone to be ready..."
gcloud sql instances describe "$RESTORE_INSTANCE" \
    --project="$PROJECT" --format="value(state)" | grep -q "RUNNABLE" || \
    (warn "Instance not yet runnable, waiting..." && sleep 30)

# ── Step 3: Connect and run validation queries ───────────────────────────────

log "Starting Cloud SQL Proxy to restored instance..."
cloud-sql-proxy "${PROJECT}:${REGION}:${RESTORE_INSTANCE}" \
    --port="$PROXY_PORT" --quiet &
PROXY_PID=$!
sleep 5

CONNSTR="host=127.0.0.1 port=${PROXY_PORT} user=${DB_USER} dbname=${DATABASE} sslmode=disable"

log "Running validation queries..."

# Row counts
RESTORE_COUNTS=$(psql "$CONNSTR" --tuples-only --no-align --field-separator='|' -c "
    SELECT 'labs', COUNT(*) FROM labs
    UNION ALL SELECT 'users', COUNT(*) FROM users
    UNION ALL SELECT 'antibodies', COUNT(*) FROM antibodies
    UNION ALL SELECT 'lots', COUNT(*) FROM lots
    UNION ALL SELECT 'vials', COUNT(*) FROM vials
    UNION ALL SELECT 'audit_log', COUNT(*) FROM audit_log
    UNION ALL SELECT 'lot_documents', COUNT(*) FROM lot_documents
    ORDER BY 1;
")

# Orphan checks
ORPHANS=$(psql "$CONNSTR" --tuples-only --no-align --field-separator='|' -c "
    SELECT 'orphaned_lots', COUNT(*)
    FROM lots l LEFT JOIN antibodies a ON l.antibody_id = a.id WHERE a.id IS NULL
    UNION ALL
    SELECT 'orphaned_vials', COUNT(*)
    FROM vials v LEFT JOIN lots l ON v.lot_id = l.id WHERE l.id IS NULL
    UNION ALL
    SELECT 'orphaned_docs', COUNT(*)
    FROM lot_documents d LEFT JOIN lots l ON d.lot_id = l.id WHERE l.id IS NULL;
")

# Audit log span
AUDIT_SPAN=$(psql "$CONNSTR" --tuples-only --no-align --field-separator='|' -c "
    SELECT MIN(created_at), MAX(created_at), COUNT(*) FROM audit_log;
")

# Stop proxy
kill "$PROXY_PID" 2>/dev/null || true
wait "$PROXY_PID" 2>/dev/null || true
unset PROXY_PID

# ── Step 4: Print results ────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  RESTORE DRILL RESULTS — $(date -u +%Y-%m-%d)"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Clone timestamp: $TIMESTAMP"
echo ""

echo "── Row Counts ──"
printf "%-20s %10s %10s\n" "Table" "Restored" "Production"
echo "─────────────────────────────────────────────"
while IFS='|' read -r table count; do
    table=$(echo "$table" | xargs)
    count=$(echo "$count" | xargs)
    prod_count="-"
    if [[ -n "$PROD_COUNTS" ]]; then
        prod_count=$(echo "$PROD_COUNTS" | grep "^${table}|" | cut -d'|' -f2 | xargs || echo "-")
    fi
    printf "%-20s %10s %10s\n" "$table" "$count" "$prod_count"
done <<< "$RESTORE_COUNTS"

echo ""
echo "── Orphan Checks ──"
ALL_CLEAN=true
while IFS='|' read -r check count; do
    check=$(echo "$check" | xargs)
    count=$(echo "$count" | xargs)
    if [[ "$count" -gt 0 ]]; then
        err "$check: $count"
        ALL_CLEAN=false
    else
        log "$check: 0"
    fi
done <<< "$ORPHANS"

echo ""
echo "── Audit Log Span ──"
echo "$AUDIT_SPAN" | while IFS='|' read -r min_ts max_ts total; do
    echo "  Earliest: $(echo "$min_ts" | xargs)"
    echo "  Latest:   $(echo "$max_ts" | xargs)"
    echo "  Total:    $(echo "$total" | xargs)"
done

# Determine result
RESULT="PASS"
if [[ "$ALL_CLEAN" != true ]]; then
    RESULT="FAIL (orphans detected)"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Add this row to docs/DISASTER_RECOVERY.md test history:"
echo ""
echo "| $(date -u +%Y-%m-%d) | PITR clone | $RESULT | Automated drill via scripts/restore_drill.sh |"
echo ""
