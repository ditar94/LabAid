# GCloud Hardening Plan

Comprehensive plan to harden, optimize, and fill gaps in LabAid's Google Cloud Platform integration. Based on a full audit of all Terraform configs, CI/CD pipelines, Docker configs, and backend service code.

**Date**: 2026-03-02
**Current state**: Solid foundation — Workload Identity Federation, Cloud SQL Auth Proxy, three-tier DB users, structured JSON logging, pre-deploy backups, Terraform remote state. But 27 findings across security, reliability, performance, and cost.

**Severity counts**: 1 Critical, 6 High, 10 Medium, 10 Low/Informational

---

## Phase 1: Critical Security & IAM (P0)

### 1.1 Grant Cloud Run SA access to Secret Manager

**Problem**: `terraform/secret_manager.tf` only grants `roles/secretmanager.secretAccessor` to the GitHub Actions SA (lines 39-44). The Cloud Run SA (`cloud-run-backend`) has NO secret access in Terraform, yet `cloud_run.tf` injects 12 secrets via `secret_key_ref` (lines 60-174). This works today only because of a manually-applied binding that Terraform doesn't track.

**Risk**: If the manual binding is ever removed or the SA is recreated, the service will fail to start. Not reproducible via `terraform apply`.

**Fix** — add to `terraform/secret_manager.tf`:
```hcl
resource "google_secret_manager_secret_iam_member" "cloud_run" {
  for_each  = toset(local.secrets)
  secret_id = google_secret_manager_secret.secrets[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.cloud_run.email}"
}
```

**Verification**: `terraform plan` should show 17 new IAM bindings (one per secret). After apply, remove the manual binding and verify the service still starts.

---

### 1.2 Set service account in Cloud Run Terraform

**Problem**: `terraform/cloud_run.tf` does NOT set `service_account` on the Cloud Run service. It's only set via `gcloud run deploy --service-account` in `.github/workflows/deploy.yml` (lines 225, 330). This creates configuration drift — Terraform state disagrees with reality.

**Risk**: If someone runs `terraform apply` without the CI/CD override, the service could fall back to the default Compute Engine SA (which has broad project-editor permissions).

**Fix** — add to the `template` block in `terraform/cloud_run.tf`:
```hcl
template {
  service_account = google_service_account.cloud_run.email

  scaling {
    # ...existing...
  }
  # ...rest of template...
}
```

**Verification**: `terraform plan` should show an update to the Cloud Run service (adding `service_account`). No downtime — this just codifies what's already running.

---

### 1.3 Enable uniform bucket-level access on GCS

**Problem**: `terraform/storage.tf` does not set `uniform_bucket_level_access`. Without it, legacy ACLs can override IAM policies, potentially exposing documents.

**Risk**: An ACL-based permission could accidentally make lab documents public.

**Fix** — add to `terraform/storage.tf`:
```hcl
resource "google_storage_bucket" "documents" {
  name          = "labaid-documents-prod"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  # Clean up old object versions to control costs
  lifecycle_rule {
    condition {
      num_newer_versions = 3
      with_state         = "NONCURRENT"
    }
    action {
      type = "Delete"
    }
  }

  soft_delete_policy {
    retention_duration_seconds = 604800  # 7-day safety net
  }

  depends_on = [google_project_service.apis]
}
```

**Verification**: `terraform plan` should show in-place update. Verify existing uploads/downloads still work after apply.

**Note**: `uniform_bucket_level_access` is a one-way switch — once enabled on an existing bucket, it cannot be disabled. Make sure no existing ACLs are being relied upon first.

---

### 1.4 Add secret rotation policy metadata

**Problem**: `terraform/secret_manager.tf` creates secrets with no rotation policy or labels. There's no way to track when secrets were last rotated or enforce a rotation schedule.

**Severity**: Medium

**Fix** — update the secret resource in `terraform/secret_manager.tf`:
```hcl
resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secrets)
  secret_id = each.value

  replication {
    auto {}
  }

  labels = {
    managed_by = "terraform"
  }

  depends_on = [google_project_service.apis]
}
```

For secrets that support automatic rotation (future consideration), add:
```hcl
# rotation {
#   rotation_period = "7776000s"  # 90 days
# }
```

**Operational process**: Establish a quarterly rotation schedule for `SECRET_KEY`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and database passwords. Document the procedure in `docs/INCIDENT_RESPONSE.md`.

**Verification**: `terraform plan` should show label additions. No restarts needed.

---

## Phase 2: Reliability & Deploy Safety (P1)

### 2.1 Add startup probe to Cloud Run

**Problem**: No startup probe in `terraform/cloud_run.tf`. The backend runs `alembic upgrade head` at startup (`Dockerfile.prod` line 18), so the container takes 5-15+ seconds to become ready. Without a startup probe, Cloud Run may route traffic before migrations finish, causing 502 errors during deploys.

**Fix** — add inside the `containers` block in `terraform/cloud_run.tf`:
```hcl
startup_probe {
  http_get {
    path = "/api/health"
    port = 8080
  }
  initial_delay_seconds = 5
  timeout_seconds       = 5
  period_seconds        = 10
  failure_threshold     = 12  # Allows up to 120s for migrations
}
```

**Verification**: Deploy a version with a slow migration (add `time.sleep(10)` to a test migration). Confirm no 502s are served during the rollout.

---

### 2.2 Add uptime checks

**Problem**: No `google_monitoring_uptime_check_config` in Terraform. The existing monitoring alerts (`monitoring.tf`) only fire on metric thresholds, which require traffic. If the service goes completely down during a zero-traffic window, nobody is alerted.

**Fix** — create `terraform/uptime.tf`:
```hcl
# ── Uptime checks ──────────────────────────────────────────────────────────

resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "LabAid API Health (${var.cloud_run_service_name})"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/api/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(var.app_url, "https://")
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "uptime_failure" {
  display_name = "LabAid API down (${var.cloud_run_service_name})"
  combiner     = "OR"

  conditions {
    display_name = "Uptime check failing"

    condition_threshold {
      filter          = "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.labels.check_id = \"${google_monitoring_uptime_check_config.api_health.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}
```

**Verification**: Apply to staging first. Temporarily break the `/api/health` endpoint and confirm you receive an email alert within 5-10 minutes.

---

### 2.3 Add CI/CD rollback on health check failure

**Problem**: `.github/workflows/deploy.yml` has a health check after deploy (lines 236-245, 341-350), but if it fails the workflow just exits with error. The broken revision remains serving traffic.

**Fix** — update both staging and production health check steps in `deploy.yml`:
```yaml
      - name: Health check
        id: health
        continue-on-error: true
        run: |
          URL=$(gcloud run services describe <SERVICE> --region=${GCP_REGION} --project=${GCP_PROJECT} --format='value(status.url)')
          for i in 1 2 3 4 5; do
            RESPONSE=$(curl -sf "${URL}/api/health" 2>&1) && break
            echo "Attempt $i failed, retrying in 10s..."
            sleep 10
          done
          echo "$RESPONSE"
          echo "$RESPONSE" | grep -q '"status":"ok"' || { echo "Health check failed!"; exit 1; }

      - name: Rollback on failure
        if: steps.health.outcome == 'failure'
        run: |
          echo "::error::Health check failed — rolling back to previous revision"
          PREV_REV=$(gcloud run revisions list \
            --service=<SERVICE> \
            --region=${GCP_REGION} \
            --project=${GCP_PROJECT} \
            --format='value(REVISION)' \
            --sort-by='~creationTimestamp' \
            --limit=2 | tail -1)
          if [ -n "$PREV_REV" ]; then
            gcloud run services update-traffic <SERVICE> \
              --to-revisions="${PREV_REV}=100" \
              --region=${GCP_REGION} \
              --project=${GCP_PROJECT}
            echo "Rolled back to: $PREV_REV"
          fi
          exit 1
```

Replace `<SERVICE>` with `labaid-backend-staging` and `labaid-backend` respectively.

**Verification**: Deploy a deliberately broken image (e.g., one that crashes on `/api/health`). Confirm the workflow rolls back to the previous revision and the service recovers.

---

### 2.4 Set Cloud Run concurrency limit and request timeout

**Problem**: No `max_instance_request_concurrency` in `cloud_run.tf`. Default is 80. But the backend runs 2 Uvicorn workers with `pool_size=5` and `max_overflow=10` — meaning each instance can realistically process ~10 concurrent DB-bound requests. At concurrency=80, requests will queue and timeout.

**Fix** — add to the `template` block in `terraform/cloud_run.tf`:
```hcl
template {
  service_account                  = google_service_account.cloud_run.email
  max_instance_request_concurrency = 30
  timeout                          = "60s"

  scaling {
    # ...existing...
  }
```

`30` accounts for 2 workers x 15 pool connections with some headroom. Also add an explicit `timeout = "60s"` (default is 300s which is too long for API requests).

**Verification**: Load test with 50 concurrent requests. Confirm Cloud Run scales to 2+ instances instead of queuing everything on one.

---

## Phase 3: Database Hardening (P1-P2)

### 3.1 Upgrade production DB tier

**Problem**: `terraform/cloud_sql.tf` line 77 — production uses `db-f1-micro` (0.6 GB RAM, shared vCPU, max ~25 connections). With `pool_size=5`, `max_overflow=10`, and `max_instances=3` in Cloud Run, you could demand 45 connections — nearly double the micro limit.

**Fix** — in `terraform/cloud_sql.tf`:
```hcl
tier = "db-g1-small"  # 1.7 GB RAM, shared vCPU, ~97 max connections
```

**Cost delta**: ~$9/mo (micro) → ~$26/mo (g1-small). Minimal for a SaaS.

**Execution**: This requires a brief restart (1-2 minutes). Schedule during a maintenance window. The HA (`availability_type = "REGIONAL"`) will handle failover.

**Verification**: After resize, check `SELECT count(*) FROM pg_stat_activity;` under load to confirm connections are within limits.

---

### 3.2 Add slow query logging

**Problem**: No performance-related database flags. You have no visibility into which queries are slow.

**Fix** — add to the `prod` instance in `terraform/cloud_sql.tf`:
```hcl
database_flags {
  name  = "log_min_duration_statement"
  value = "1000"  # Log queries taking > 1 second
}

database_flags {
  name  = "log_connections"
  value = "on"
}

database_flags {
  name  = "log_disconnections"
  value = "on"
}
```

**Verification**: After apply (requires restart), run a slow query and confirm it appears in Cloud SQL logs in the Cloud Console.

---

### 3.3 Separate staging and beta databases

**Problem**: `terraform/environments/staging.tfvars` and `beta.tfvars` both use `DATABASE_URL_BETA` / `DATABASE_URL_BETA_MIGRATE`. They share the same database on the nonprod instance.

**Fix**:
1. Add a staging database resource to `terraform/cloud_sql.tf`:
```hcl
resource "google_sql_database" "staging" {
  name     = "labaid_staging"
  instance = google_sql_database_instance.nonprod.name
}
```

2. Create new secrets `DATABASE_URL_STAGING` and `DATABASE_URL_STAGING_MIGRATE` in the secrets list.

3. Update `terraform/environments/staging.tfvars`:
```hcl
db_secret_name          = "DATABASE_URL_STAGING"
db_migrate_secret_name  = "DATABASE_URL_STAGING_MIGRATE"
```

4. Set the secret values via:
```bash
echo -n "postgresql+psycopg2://labaid_app:<password>@/<db>?host=/cloudsql/labaid-prod:us-central1:labaid-db-nonprod" | \
  gcloud secrets versions add DATABASE_URL_STAGING --data-file=-
```

**Verification**: Deploy to staging and beta separately. Confirm they use different databases by checking data isolation.

---

### 3.4 Consider VPC Connector for Cloud SQL

**Problem**: `terraform/cloud_sql.tf` line 98 has `ipv4_enabled = true` (public IP). Cloud Run connects via the Cloud SQL Auth Proxy sidecar (Unix socket at `/cloudsql/`), which provides encrypted, IAM-authenticated connections. However, the database has a public IP, which increases attack surface even though `require_ssl = true` and authorized networks are restricted.

**Severity**: Medium (informational for now)

**Current state is acceptable**: The Cloud SQL Auth Proxy via Unix socket provides equivalent security to a VPC — all traffic is encrypted and IAM-authenticated. Adding a VPC Connector would add ~$7/mo cost and networking complexity.

**When to revisit**: When adding a second GCP service that needs database access (e.g., Cloud Functions, Cloud Run Jobs), or if compliance requirements mandate private-only networking.

**Future fix** (not needed now):
```hcl
resource "google_vpc_access_connector" "connector" {
  name          = "labaid-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = "default"
}
```

Then set `ipv4_enabled = false` on Cloud SQL and add `vpc_access { connector = google_vpc_access_connector.connector.id }` to the Cloud Run template.

---

## Phase 4: Config Drift Elimination (P2)

### 4.1 Align Terraform and CI/CD Cloud Run management

**Problem**: Terraform defines the Cloud Run service structure, but CI/CD (`gcloud run deploy`) overrides it on every deploy with its own flags (`--max-instances 3`, `--memory 512Mi`, `--set-secrets`, etc.). The two sources of truth disagree. For example, CI sets `--max-instances 3` for staging, but `staging.tfvars` says `max_instances = 1`.

**Strategy**: Make Terraform the single source of truth for Cloud Run configuration. CI/CD should only update the container image.

**Fix**:
1. Ensure `terraform/cloud_run.tf` has ALL configuration (service account, concurrency, timeout, probes — most of which we're adding in this plan).

2. Add `lifecycle.ignore_changes` for the image (already done on line 192-194).

3. Replace `gcloud run deploy` in CI/CD with a minimal image update:
```yaml
      - name: Update Cloud Run image
        run: |
          gcloud run services update $SERVICE_NAME \
            --image ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}/backend:${GITHUB_SHA} \
            --region ${GCP_REGION} \
            --project ${GCP_PROJECT}
```

This only updates the image tag. All other config (secrets, env vars, scaling, probes) comes from Terraform.

**Caveat**: This requires running `terraform apply` to propagate any config changes. The CI/CD pipeline should NOT duplicate any Terraform-managed settings.

**Verification**: After switching, run `terraform plan` — it should show no changes (no drift).

---

### 4.2 Parameterize monitoring alert filters

**Problem**: `terraform/monitoring.tf` hardcodes `labaid-db-prod` and `labaid-backend` in filter strings (lines 24, 111, 142, 171, 200, 225, 264). When applied with beta/staging tfvars, alerts still point at production resources.

**Fix** — replace hardcoded names with variables throughout `monitoring.tf`:
```hcl
# Before:
filter = "... resource.labels.database_id = \"${var.project_id}:labaid-db-prod\" ..."

# After:
filter = "... resource.labels.database_id = \"${var.project_id}:${var.cloud_sql_instance_name}\" ..."
```

```hcl
# Before:
filter = "... resource.labels.service_name = \"labaid-backend\" ..."

# After:
filter = "... resource.labels.service_name = \"${var.cloud_run_service_name}\" ..."
```

Apply this to all 8 occurrences in `monitoring.tf` (SQL CPU, SQL memory, SQL disk, SQL connections, Run instances, Run 5xx, Run latency, backup failure/success).

**Verification**: `terraform plan -var-file=environments/staging.tfvars` should show alerts targeting `labaid-backend-staging` and `labaid-db-nonprod`.

---

## Phase 5: Cost Optimization (P3)

### 5.1 Move non-secrets out of Secret Manager

**Problem**: `CORS_ORIGINS`, `COOKIE_DOMAIN`, and `S3_BUCKET` are stored in Secret Manager and injected via `secret_key_ref`. These are not sensitive — they're configuration values like `https://labaid.io` and `.labaid.io`.

**Cost**: Each secret version access costs $0.03/10,000 ops. More importantly, it complicates configuration management and obscures what's actually secret.

**Fix** — in `terraform/cloud_run.tf`, change these three from `secret_key_ref` to plain `value`:
```hcl
env {
  name  = "CORS_ORIGINS"
  value = var.cors_origins
}
env {
  name  = "COOKIE_DOMAIN"
  value = var.cookie_domain
}
env {
  name  = "S3_BUCKET"
  value = var.s3_bucket
}
```

Add corresponding variables to `terraform/variables.tf` and values to each `.tfvars` file:
```hcl
# variables.tf
variable "cors_origins" {
  description = "Comma-separated CORS origins"
  type        = string
}
variable "cookie_domain" {
  description = "Cookie domain"
  type        = string
}
variable "s3_bucket" {
  description = "GCS bucket name"
  type        = string
}
```

```hcl
# prod.tfvars
cors_origins  = "https://labaid.io"
cookie_domain = ".labaid.io"
s3_bucket     = "labaid-documents-prod"
```

Also update CI/CD `--set-secrets` and `--set-env-vars` flags accordingly (or remove them entirely if Terraform becomes the single source per Phase 4).

**Verification**: Deploy and confirm CORS, cookies, and file uploads all work.

---

### 5.2 Add variable validation

**Fix** — add to `terraform/variables.tf`:
```hcl
variable "max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
  default     = 1

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10
    error_message = "max_instances must be between 1 and 10."
  }
}

variable "email_backend" {
  description = "Email backend: console or resend"
  type        = string
  default     = "console"

  validation {
    condition     = contains(["console", "resend"], var.email_backend)
    error_message = "email_backend must be 'console' or 'resend'."
  }
}
```

---

### 5.3 Add `prevent_destroy` on stateful resources

**Problem**: While `deletion_protection = true` is set on Cloud SQL instances (good), there's no Terraform-level guard on the GCS bucket. A careless `terraform destroy` or resource removal could delete the document bucket.

**Severity**: Low (belt-and-suspenders; `force_destroy = false` already provides some protection)

**Fix** — add lifecycle blocks to `terraform/storage.tf` and optionally to SQL instances:
```hcl
resource "google_storage_bucket" "documents" {
  # ...existing config...

  lifecycle {
    prevent_destroy = true
  }
}
```

For Cloud SQL, the existing `deletion_protection = true` + `deletion_protection_enabled = true` is sufficient, but you can add `prevent_destroy` for an extra layer:
```hcl
resource "google_sql_database_instance" "prod" {
  # ...existing config...

  lifecycle {
    prevent_destroy = true
  }
}
```

**Verification**: Run `terraform plan` with a hypothetical removal — it should error with "prevent_destroy" message.

---

### 5.4 Add GCS CORS configuration (informational)

**Problem**: No CORS configuration on the GCS bucket. Pre-signed URLs for document downloads currently work via browser redirect (the backend returns a signed URL, browser navigates to `storage.googleapis.com`), so CORS isn't strictly needed. But if the frontend ever switches to `fetch()` downloads, it will break.

**Severity**: Low (informational — current redirect pattern works fine)

**Fix** — add CORS config to `terraform/storage.tf` for future-proofing:
```hcl
cors {
  origin          = ["https://labaid.io", "https://staging.labaid.io", "https://beta.labaid.io"]
  method          = ["GET", "HEAD"]
  response_header = ["Content-Type", "Content-Disposition"]
  max_age_seconds = 3600
}
```

**Verification**: Only needed if switching to `fetch()` downloads. Not urgent.

---

## Phase 6: CI/CD Hardening (P2)

### 6.1 Add beta backend deployment

**Problem**: The deploy pipeline (`.github/workflows/deploy.yml`) triggers on `push to beta` but only deploys to staging (auto) and production (manual approval). There is no beta backend deployment step, even though `beta.tfvars` exists with `cloud_run_service_name = "labaid-backend-beta"`.

**Severity**: Medium

**Fix** — add a beta deployment job before staging in `deploy.yml`:
```yaml
  beta-backend:
    name: Deploy Backend (Beta)
    needs: [test]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker auth
        run: gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev --quiet

      - uses: docker/setup-buildx-action@v3

      - name: Build and push image
        uses: docker/build-push-action@v5
        with:
          context: backend
          file: backend/Dockerfile.prod
          push: true
          tags: |
            ${{ env.GCP_REGION }}-docker.pkg.dev/${{ env.GCP_PROJECT }}/${{ env.REPO_NAME }}/backend:beta
            ${{ env.GCP_REGION }}-docker.pkg.dev/${{ env.GCP_PROJECT }}/${{ env.REPO_NAME }}/backend:beta-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64

      - name: Deploy to Cloud Run
        run: |
          gcloud run services update labaid-backend-beta \
            --image ${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}/backend:beta-${GITHUB_SHA} \
            --region ${GCP_REGION} \
            --project ${GCP_PROJECT}
```

**Note**: If using the Phase 4 approach (Terraform as single source of truth), this simplifies to just image push + `gcloud run services update`.

**Alternative**: If beta is intentionally kept as a manual deploy, document this decision. Currently it's ambiguous.

**Verification**: Push to beta branch and confirm the beta backend service is updated.

---

## Phase 7: Automation & Scheduled Tasks (P2)

### 7.1 Add Cloud Scheduler for Stripe event cleanup

**Problem**: The endpoint `DELETE /api/stripe/events/cleanup` (in `backend/app/routers/stripe_webhook.py`) requires manual super_admin invocation. Without automation, the `stripe_events` table grows indefinitely.

**Severity**: High

**Approach**: Cloud Scheduler → Cloud Run. The tricky part is auth — the endpoint currently requires a `SUPER_ADMIN` JWT.

**Option A — Internal endpoint with OIDC auth** (recommended):
1. Create a new internal endpoint `/api/internal/stripe-cleanup` that accepts Cloud Scheduler OIDC tokens instead of JWT auth.
2. Add a Cloud Scheduler job in Terraform.

**Fix** — add to `terraform/scheduler.tf`:
```hcl
resource "google_cloud_scheduler_job" "stripe_cleanup" {
  name     = "labaid-stripe-event-cleanup"
  schedule = "0 3 * * 0"  # Weekly, Sunday at 3 AM UTC
  region   = var.region

  http_target {
    http_method = "DELETE"
    uri         = "${google_cloud_run_v2_service.backend.uri}/api/internal/stripe-cleanup"

    oidc_token {
      service_account_email = google_service_account.cloud_run.email
      audience              = google_cloud_run_v2_service.backend.uri
    }
  }

  retry_config {
    retry_count          = 3
    min_backoff_duration = "30s"
    max_backoff_duration = "300s"
  }

  depends_on = [google_project_service.apis]
}
```

Also enable the Cloud Scheduler API in `terraform/main.tf`:
```hcl
"cloudscheduler.googleapis.com",
```

**Backend change**: Add an internal auth dependency that validates the OIDC token's service account matches `cloud-run-backend@labaid-prod.iam.gserviceaccount.com`, then reuse the existing cleanup logic.

**Verification**: Manually trigger the job via `gcloud scheduler jobs run labaid-stripe-event-cleanup`. Confirm old events are deleted.

---

## Phase 8: Future Considerations (P3, non-urgent)

These are not urgent but should be on the roadmap as the customer base grows.

### 8.1 Migrate GCS access from HMAC/boto3 to native `google-cloud-storage`

**Current**: `backend/app/services/object_storage.py` uses boto3 with S3-compatible HMAC keys. Works, but requires managing static credentials.

**Future**: Switch to `google-cloud-storage` library for production (automatic IAM auth via the Cloud Run SA). Keep boto3 for local dev with MinIO. Eliminates `S3_ACCESS_KEY` and `S3_SECRET_KEY` secrets entirely.

### 8.2 Cloud Armor / WAF

Requires a Cloud Load Balancer + serverless NEG in front of Cloud Run (replacing direct Firebase Hosting → Cloud Run rewrites). Consider when the customer base grows and DDoS/bot protection becomes necessary. Current application-level rate limiting via slowapi provides baseline protection.

### 8.3 Distributed tracing (OpenTelemetry → Cloud Trace)

Add `opentelemetry-instrumentation-fastapi` and `opentelemetry-instrumentation-sqlalchemy` for request-level visibility. Critical when debugging multi-tenant performance issues at scale.

### 8.4 Memorystore (Redis) for shared cache

In-memory caching (`backend/app/core/cache.py`) works at 1-3 instances. At 5+ instances, cache invalidation lag (up to 60s TTL) becomes problematic for billing status checks. Memorystore provides a shared cache across all instances.

### 8.5 Cloud Run Jobs for migrations

Move `alembic upgrade head` out of the container entrypoint and into a Cloud Run Job that runs before the service deploy. Eliminates 5-15s cold start penalty and removes concurrent migration risk.

---

## Execution Order

| Step | Phase | Items | Terraform Apply? | Downtime? |
|------|-------|-------|-----------------|-----------|
| 1 | Phase 1 | 1.1, 1.2, 1.3, 1.4 | Yes | No |
| 2 | Phase 2 | 2.1, 2.2, 2.4 | Yes | No |
| 3 | Phase 3 | 3.1 (DB upgrade) | Yes | 1-2 min restart |
| 4 | Phase 3 | 3.2 (slow query logging) | Yes | Brief restart |
| 5 | Phase 2 | 2.3 (CI/CD rollback) | No (CI change) | No |
| 6 | Phase 2 | 2.2 (uptime checks) | Yes | No |
| 7 | Phase 4 | 4.1, 4.2 | Yes + CI change | No |
| 8 | Phase 5 | 5.1, 5.2, 5.3, 5.4 | Yes + CI change | No |
| 9 | Phase 3 | 3.3 (staging DB split) | Yes + secrets | No |
| 10 | Phase 6 | 6.1 (beta deployment) | No (CI change) | No |
| 11 | Phase 7 | 7.1 (Cloud Scheduler) | Yes + backend | No |
| 12 | Phase 8 | 8.1-8.5 (future roadmap) | Various | Various |

Steps 1-2 can be done in a single `terraform apply` with no downtime.
Step 3 should be scheduled during low traffic (the HA failover handles it but there's a brief blip).
Steps 5, 7, and 10 involve CI/CD changes that should be tested on a feature branch first.

---

## Full Finding Index

| # | Finding | Severity | Phase | Status |
|---|---------|----------|-------|--------|
| 1 | Cloud Run SA missing Secret Manager IAM | Critical | 1.1 | DONE |
| 2 | Service account not set in Cloud Run Terraform | High | 1.2 | DONE |
| 3 | No uniform bucket-level access on GCS | High | 1.3 | DONE |
| 4 | No secret rotation policy | Medium | 1.4 | DONE |
| 5 | No startup probe on Cloud Run | High | 2.1 | DONE |
| 6 | No uptime checks | High | 2.2 | DONE |
| 7 | No CI/CD rollback strategy | Medium | 2.3 | DONE |
| 8 | No Cloud Run concurrency limit | Medium | 2.4 | DONE |
| 9 | Production DB on db-f1-micro | High | 3.1 | DONE |
| 10 | No slow query logging | Medium | 3.2 | DONE |
| 11 | Staging and beta share same database | Medium | 3.3 | DONE |
| 12 | No VPC Connector (informational) | Medium | 3.4 | Deferred |
| 13 | Terraform/CI Cloud Run config drift | Medium | 4.1 | DONE |
| 14 | Monitoring alerts hardcode prod names | Low | 4.2 | DONE |
| 15 | Non-secrets in Secret Manager | Low | 5.1 | DONE |
| 16 | No Terraform variable validation | Low | 5.2 | DONE |
| 17 | No prevent_destroy on stateful resources | Low | 5.3 | DONE |
| 18 | No GCS CORS configuration (informational) | Low | 5.4 | Deferred |
| 19 | No beta backend deployment in CI/CD | Medium | 6.1 | DONE |
| 20 | No Cloud Scheduler for cleanup tasks | High | 7.1 | DONE |
| 21 | GCS via HMAC keys instead of native IAM | Medium | 8.1 | Deferred |
| 22 | No Cloud Armor / WAF | Medium | 8.2 | Deferred |
| 23 | No distributed tracing (Cloud Trace) | Low | 8.3 | Deferred |
| 24 | No shared cache (Memorystore) | Low | 8.4 | Deferred |
| 25 | Migrations in container entrypoint | High | 8.5 | Deferred |
| 26 | No request timeout on Cloud Run | Low | 2.4 | DONE |
| 27 | CPU idle config (informational — already optimal) | Low | N/A | No action |

---

## Files Modified

| File | Phases |
|------|--------|
| `terraform/secret_manager.tf` | 1 |
| `terraform/cloud_run.tf` | 1, 2, 5 |
| `terraform/storage.tf` | 1, 5 |
| `terraform/cloud_sql.tf` | 3 |
| `terraform/monitoring.tf` | 4 |
| `terraform/variables.tf` | 5 |
| `terraform/environments/prod.tfvars` | 5 |
| `terraform/environments/staging.tfvars` | 3, 5 |
| `terraform/environments/beta.tfvars` | 5 |
| `terraform/uptime.tf` (new) | 2 |
| `terraform/scheduler.tf` (new) | 7 |
| `terraform/main.tf` | 7 |
| `.github/workflows/deploy.yml` | 2, 4, 6 |
| `backend/app/routers/internal.py` (new) | 7 |
| `backend/app/main.py` | 7 |
