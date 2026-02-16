# ── Non-production instance (beta + staging) ────────────────────────────────

resource "google_sql_database_instance" "nonprod" {
  name                = "labaid-db-nonprod"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4 # 4 AM UTC
    }

    ip_configuration {
      ipv4_enabled = true

      dynamic "authorized_networks" {
        for_each = var.authorized_networks
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.value
        }
      }
    }
  }
}

resource "google_sql_database" "beta" {
  name     = "labaid_beta"
  instance = google_sql_database_instance.nonprod.name
}


# ── Production instance (separate for isolation) ────────────────────────────

resource "google_sql_database_instance" "prod" {
  name                = "labaid-db-prod"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  settings {
    tier              = "db-f1-micro" # upgrade to db-g1-small when needed
    availability_type = "REGIONAL"    # HA for production

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
      }
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 4 # 4 AM UTC
    }

    ip_configuration {
      ipv4_enabled = true

      dynamic "authorized_networks" {
        for_each = var.authorized_networks
        content {
          name  = authorized_networks.value.name
          value = authorized_networks.value.value
        }
      }
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }
  }
}

resource "google_sql_database" "prod" {
  name     = "labaid"
  instance = google_sql_database_instance.prod.name
}


# ── Database users ──────────────────────────────────────────────────────────

# App user (Cloud Run runtime — DML only, no DDL)
resource "google_sql_user" "app_nonprod" {
  name     = "labaid_app"
  instance = google_sql_database_instance.nonprod.name
  password = "change-me" # Set real password via: gcloud sql users set-password
}

resource "google_sql_user" "app_prod" {
  name     = "labaid_app"
  instance = google_sql_database_instance.prod.name
  password = "change-me"
}

# Migration user (Alembic — full DDL)
resource "google_sql_user" "migrate_nonprod" {
  name     = "labaid_migrate"
  instance = google_sql_database_instance.nonprod.name
  password = "change-me"
}

resource "google_sql_user" "migrate_prod" {
  name     = "labaid_migrate"
  instance = google_sql_database_instance.prod.name
  password = "change-me"
}

# Read-only user (support queries, debugging)
resource "google_sql_user" "readonly_nonprod" {
  name     = "labaid_readonly"
  instance = google_sql_database_instance.nonprod.name
  password = "change-me"
}

resource "google_sql_user" "readonly_prod" {
  name     = "labaid_readonly"
  instance = google_sql_database_instance.prod.name
  password = "change-me"
}

# IAM-authenticated user for Cloud Run (production only — Phase 4)
resource "google_sql_user" "iam_app" {
  name     = google_service_account.cloud_run.email
  instance = google_sql_database_instance.prod.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}
