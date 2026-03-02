# ── Cloud Run Service Account ────────────────────────────────────────────────

resource "google_service_account" "cloud_run" {
  account_id   = "cloud-run-backend"
  display_name = "Cloud Run Backend"
  description  = "Service account for the LabAid backend Cloud Run service"
}

# Allow Cloud Run SA to connect to Cloud SQL via IAM authentication (Phase 4)
resource "google_project_iam_member" "cloud_run_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Allow Cloud Run SA to authenticate as a database user via IAM (Phase 4)
resource "google_project_iam_member" "cloud_run_sql_instance_user" {
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# Allow Cloud Run SA to create and manage SSO client secrets (labaid-sso-*)
# oidc_service.py dynamically creates secrets via the Secret Manager API.
# Custom role with minimal permissions instead of broad secretmanager.admin.
resource "google_project_iam_custom_role" "sso_secret_manager" {
  role_id     = "ssoSecretManager"
  title       = "SSO Secret Manager"
  description = "Minimal permissions for creating and managing SSO client secrets"
  permissions = [
    "secretmanager.secrets.get",
    "secretmanager.secrets.create",
    "secretmanager.versions.add",
    "secretmanager.versions.access",
  ]
}

resource "google_project_iam_member" "cloud_run_sso_secrets" {
  project = var.project_id
  role    = google_project_iam_custom_role.sso_secret_manager.id
  member  = "serviceAccount:${google_service_account.cloud_run.email}"
}

# ── GitHub Actions Service Account ──────────────────────────────────────────

resource "google_service_account" "github_actions" {
  account_id   = "github-actions"
  display_name = "GitHub Actions CI/CD"
  description  = "Service account for GitHub Actions deployments"
}

# ── IAM Role Bindings ──────────────────────────────────────────────────────

locals {
  github_sa_roles = [
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/cloudsql.client",
    "roles/iam.serviceAccountUser",
    "roles/firebasehosting.admin",
  ]
}

resource "google_project_iam_member" "github_actions" {
  for_each = toset(local.github_sa_roles)
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.github_actions.email}"
}

# ── Workload Identity Federation ───────────────────────────────────────────

resource "google_iam_workload_identity_pool" "github" {
  provider                  = google-beta
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"
  description               = "WIF pool for GitHub Actions OIDC"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  provider                           = google-beta
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC Provider"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.actor"      = "assertion.actor"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository_owner == 'ditar94'"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Allow GitHub Actions to impersonate the service account
resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
