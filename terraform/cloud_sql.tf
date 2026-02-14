resource "google_sql_database_instance" "main" {
  name                = "labaid-db"
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
    }
  }
}

# Three databases on the same instance
resource "google_sql_database" "prod" {
  name     = "labaid"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_database" "staging" {
  name     = "labaid_staging"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_database" "beta" {
  name     = "labaid_beta"
  instance = google_sql_database_instance.main.name
}
