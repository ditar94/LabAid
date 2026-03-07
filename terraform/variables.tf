variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for all resources"
  type        = string
  default     = "us-central1"
}

variable "cloud_run_service_name" {
  description = "Cloud Run service name"
  type        = string
}

variable "min_instances" {
  description = "Minimum Cloud Run instances (1 = always warm, 0 = scale to zero)"
  type        = number
  default     = 0
}

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

variable "app_url" {
  description = "Public application URL"
  type        = string
}

variable "db_secret_name" {
  description = "Secret Manager secret name for DATABASE_URL (app runtime)"
  type        = string
  default     = "DATABASE_URL"
}

variable "db_migrate_secret_name" {
  description = "Secret Manager secret name for DATABASE_URL_MIGRATE (Alembic migrations)"
  type        = string
  default     = "DATABASE_URL_MIGRATE"
}

variable "cloud_sql_instance_name" {
  description = "Cloud SQL instance name (e.g. labaid-db-prod or labaid-db-nonprod)"
  type        = string
  default     = "labaid-db-nonprod"
}

variable "authorized_networks" {
  description = "List of authorized networks for Cloud SQL (name/value pairs)"
  type = list(object({
    name  = string
    value = string
  }))
  default = []
}

variable "github_repo" {
  description = "GitHub repository (owner/repo)"
  type        = string
  default     = "ditar94/LabAid"
}

variable "stripe_secret_key_name" {
  description = "Secret Manager secret name for STRIPE_SECRET_KEY"
  type        = string
  default     = "STRIPE_SECRET_KEY"
}

variable "stripe_webhook_secret_name" {
  description = "Secret Manager secret name for STRIPE_WEBHOOK_SECRET"
  type        = string
  default     = "STRIPE_WEBHOOK_SECRET"
}

variable "stripe_price_id_name" {
  description = "Secret Manager secret name for STRIPE_PRICE_ID"
  type        = string
  default     = "STRIPE_PRICE_ID"
}

variable "stripe_enterprise_price_id_name" {
  description = "Secret Manager secret name for STRIPE_ENTERPRISE_PRICE_ID"
  type        = string
  default     = "STRIPE_ENTERPRISE_PRICE_ID"
}

variable "alert_email" {
  description = "Email address for monitoring alerts"
  type        = string
}

variable "cors_origins" {
  description = "Comma-separated CORS origins"
  type        = string
}

variable "cookie_domain" {
  description = "Cookie domain"
  type        = string
}

variable "s3_bucket" {
  description = "GCS bucket name for document storage"
  type        = string
}
