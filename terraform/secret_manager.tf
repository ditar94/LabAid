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
