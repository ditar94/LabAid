#!/bin/bash
# Blocks direct terraform apply/destroy commands.
# Forces use of ./scripts/tf-apply.sh which checks for destructive actions
# on stateful resources (Cloud SQL, GCS buckets) before applying.
#
# This hook exists because of the 2026-02-16 incident where terraform apply
# destroyed the beta database. See docs/DISASTER_RECOVERY.md.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command')

# Block: terraform apply, terraform destroy, terraform taint, terraform untaint
# Allow: terraform plan, terraform init, terraform validate, terraform fmt, terraform show, terraform state
if echo "$COMMAND" | grep -qE '(^|\s|&&|\|)(terraform\s+(apply|destroy|taint|untaint))(\s|$|;)'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Direct terraform apply/destroy is BLOCKED. Use ./scripts/tf-apply.sh instead — it runs terraform plan, checks for destructive actions on Cloud SQL and other stateful resources, and only applies if safe. Example: ./scripts/tf-apply.sh beta.tfvars"
    }
  }'
  exit 0
fi

exit 0
