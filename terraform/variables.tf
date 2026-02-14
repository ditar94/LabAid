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

variable "max_instances" {
  description = "Maximum Cloud Run instances"
  type        = number
  default     = 1
}

variable "email_backend" {
  description = "Email backend: console or resend"
  type        = string
  default     = "console"
}

variable "app_url" {
  description = "Public application URL"
  type        = string
}

variable "db_secret_name" {
  description = "Secret Manager secret name for DATABASE_URL"
  type        = string
  default     = "DATABASE_URL"
}

variable "github_repo" {
  description = "GitHub repository (owner/repo)"
  type        = string
  default     = "ditar94/LabAid"
}
