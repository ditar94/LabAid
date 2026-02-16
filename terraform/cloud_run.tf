resource "google_cloud_run_v2_service" "backend" {
  name     = var.cloud_run_service_name
  location = var.region

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/labaid/backend:latest"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      # Plain environment variables
      env {
        name  = "COOKIE_SECURE"
        value = "True"
      }
      env {
        name  = "COOKIE_SAMESITE"
        value = "lax"
      }
      env {
        name  = "S3_ENDPOINT_URL"
        value = "https://storage.googleapis.com"
      }
      env {
        name  = "S3_USE_PATH_STYLE"
        value = "False"
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "EMAIL_BACKEND"
        value = var.email_backend
      }
      env {
        name  = "APP_URL"
        value = var.app_url
      }

      # Secrets
      env {
        name = "SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = "SECRET_KEY"
            version = "latest"
          }
        }
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.db_secret_name
            version = "latest"
          }
        }
      }
      env {
        name = "DATABASE_URL_MIGRATE"
        value_source {
          secret_key_ref {
            secret  = var.db_migrate_secret_name
            version = "latest"
          }
        }
      }
      env {
        name = "S3_ACCESS_KEY"
        value_source {
          secret_key_ref {
            secret  = "S3_ACCESS_KEY"
            version = "latest"
          }
        }
      }
      env {
        name = "S3_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = "S3_SECRET_KEY"
            version = "latest"
          }
        }
      }
      env {
        name = "S3_BUCKET"
        value_source {
          secret_key_ref {
            secret  = "S3_BUCKET"
            version = "latest"
          }
        }
      }
      env {
        name = "CORS_ORIGINS"
        value_source {
          secret_key_ref {
            secret  = "CORS_ORIGINS"
            version = "latest"
          }
        }
      }
      env {
        name = "COOKIE_DOMAIN"
        value_source {
          secret_key_ref {
            secret  = "COOKIE_DOMAIN"
            version = "latest"
          }
        }
      }

      # RESEND_API_KEY only needed when email_backend=resend
      dynamic "env" {
        for_each = var.email_backend == "resend" ? [1] : []
        content {
          name = "RESEND_API_KEY"
          value_source {
            secret_key_ref {
              secret  = "RESEND_API_KEY"
              version = "latest"
            }
          }
        }
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = ["${var.project_id}:${var.region}:${var.cloud_sql_instance_name}"]
      }
    }
  }

  # Terraform manages service config; CI/CD manages which image is deployed
  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }

  depends_on = [google_project_service.apis]
}

# Allow unauthenticated access (public API)
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
