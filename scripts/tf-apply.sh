#!/usr/bin/env bash
#
# Safe Terraform apply wrapper — blocks destroy/replace on stateful resources.
#
# USE THIS instead of raw `terraform apply` for all infrastructure changes.
#
# What it does:
#   1. Runs `terraform plan` and saves it as JSON
#   2. Checks for destroy or replace actions on protected resource types
#   3. If any are found, prints a big red warning and refuses to apply
#   4. Otherwise, applies the plan
#
# Usage:
#   ./scripts/tf-apply.sh                          # default (beta.tfvars)
#   ./scripts/tf-apply.sh prod.tfvars              # production
#   ./scripts/tf-apply.sh staging.tfvars           # staging
#   ./scripts/tf-apply.sh -- -target=google_...    # extra args passed to plan/apply

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TF_DIR="${SCRIPT_DIR}/../terraform"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

# ── Protected resource types ─────────────────────────────────────────────────
# These are stateful resources where destroy = data loss.
# Add more as needed.
PROTECTED_TYPES=(
  "google_sql_database_instance"
  "google_sql_database"
  "google_sql_user"
  "google_storage_bucket"
)

# ── Parse arguments ──────────────────────────────────────────────────────────
TFVARS_FILE="beta.tfvars"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      EXTRA_ARGS+=("$@")
      break
      ;;
    *.tfvars)
      TFVARS_FILE="$1"
      shift
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

# Resolve tfvars path
if [[ ! "$TFVARS_FILE" == /* ]]; then
  if [[ -f "${TF_DIR}/environments/${TFVARS_FILE}" ]]; then
    TFVARS_FILE="environments/${TFVARS_FILE}"
  fi
fi

echo -e "${BOLD}Terraform Safe Apply${NC}"
echo -e "  tfvars: ${TFVARS_FILE}"
echo -e "  extra:  ${EXTRA_ARGS[*]:-none}"
echo ""

# ── Plan ─────────────────────────────────────────────────────────────────────
PLAN_FILE=$(mktemp /tmp/tfplan.XXXXXX)
PLAN_JSON=$(mktemp /tmp/tfplan.XXXXXX.json)
trap "rm -f '$PLAN_FILE' '$PLAN_JSON'" EXIT

echo -e "${BOLD}Running terraform plan...${NC}"
cd "$TF_DIR"
terraform plan \
  -var-file="$TFVARS_FILE" \
  -out="$PLAN_FILE" \
  "${EXTRA_ARGS[@]}" 2>&1

# Convert plan to JSON for inspection
terraform show -json "$PLAN_FILE" > "$PLAN_JSON"

# ── Check for destructive actions on protected resources ─────────────────────
BLOCKED=false
BLOCK_DETAILS=""

for resource_type in "${PROTECTED_TYPES[@]}"; do
  # Find resources of this type with delete or delete-before-create actions
  DESTROYS=$(python3 -c "
import json, sys
with open('$PLAN_JSON') as f:
    plan = json.load(f)
changes = plan.get('resource_changes', [])
for c in changes:
    if c.get('type') == '$resource_type':
        actions = c.get('change', {}).get('actions', [])
        if 'delete' in actions:
            name = c.get('address', 'unknown')
            action_str = '+'.join(actions)
            print(f'  {name} ({action_str})')
" 2>/dev/null || true)

  if [[ -n "$DESTROYS" ]]; then
    BLOCKED=true
    BLOCK_DETAILS+="
${RED}${resource_type}:${NC}
${DESTROYS}
"
  fi
done

if [[ "$BLOCKED" == true ]]; then
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  BLOCKED: Plan would DESTROY stateful resources                ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${RED}The following protected resources would be destroyed:${NC}"
  echo -e "$BLOCK_DETAILS"
  echo ""
  echo -e "${YELLOW}If you renamed a Terraform resource key, use state mv instead:${NC}"
  echo -e "  terraform state mv google_sql_database_instance.OLD google_sql_database_instance.NEW"
  echo ""
  echo -e "${YELLOW}If you need to change a Cloud SQL instance name, you CANNOT rename in place.${NC}"
  echo -e "  Create a new instance, migrate data, then decommission the old one."
  echo ""
  echo -e "${RED}Apply has been blocked. If you are CERTAIN this is intentional,${NC}"
  echo -e "${RED}run terraform apply directly (at your own risk):${NC}"
  echo -e "  cd terraform && terraform apply -var-file=\"$TFVARS_FILE\""
  echo ""
  exit 1
fi

# ── Apply ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}No destructive actions on protected resources detected.${NC}"
echo ""
read -p "Apply this plan? (yes/no): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
  echo "Aborted."
  exit 0
fi

terraform apply "$PLAN_FILE"
echo ""
echo -e "${GREEN}Apply complete.${NC}"
