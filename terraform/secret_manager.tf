# Secret Manager resources — Terraform manages the secrets,
# values are set manually via: gcloud secrets versions add SECRET_NAME --data-file=-

locals {
  secrets = [
    "SECRET_KEY",
    "DATABASE_URL",
    "DATABASE_URL_MIGRATE",
    "DATABASE_URL_BETA",
    "DATABASE_URL_BETA_MIGRATE",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "S3_BUCKET",
    "CORS_ORIGINS",
    "COOKIE_DOMAIN",
    "RESEND_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_ID",
    "STRIPE_SECRET_KEY_BETA",
    "STRIPE_WEBHOOK_SECRET_BETA",
    "STRIPE_PRICE_ID_BETA",
  ]
}

resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(local.secrets)
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# Grant GitHub Actions SA access to individual secrets (least-privilege)
# instead of project-level roles/secretmanager.secretAccessor
resource "google_secret_manager_secret_iam_member" "github_actions" {
  for_each  = toset(local.secrets)
  secret_id = google_secret_manager_secret.secrets[each.key].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.github_actions.email}"
}
