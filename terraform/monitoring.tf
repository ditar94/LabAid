# ── Notification channel (email) ─────────────────────────────────────────────

resource "google_monitoring_notification_channel" "email" {
  display_name = "LabAid Alerts"
  type         = "email"

  labels = {
    email_address = var.alert_email
  }

  depends_on = [google_project_service.apis]
}

# ── Cloud SQL alerts (production instance) ───────────────────────────────────

resource "google_monitoring_alert_policy" "sql_cpu" {
  display_name = "Cloud SQL CPU > 80%"
  combiner     = "OR"

  conditions {
    display_name = "CPU utilization high"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:labaid-db-prod\" AND metric.type = \"cloudsql.googleapis.com/database/cpu/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "sql_memory" {
  display_name = "Cloud SQL Memory > 85%"
  combiner     = "OR"

  conditions {
    display_name = "Memory utilization high"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:labaid-db-prod\" AND metric.type = \"cloudsql.googleapis.com/database/memory/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.85
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "sql_disk" {
  display_name = "Cloud SQL Disk > 80%"
  combiner     = "OR"

  conditions {
    display_name = "Disk utilization high"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:labaid-db-prod\" AND metric.type = \"cloudsql.googleapis.com/database/disk/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.8
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "sql_connections" {
  display_name = "Cloud SQL Connections > 80"
  combiner     = "OR"

  conditions {
    display_name = "Active connections high"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND resource.labels.database_id = \"${var.project_id}:labaid-db-prod\" AND metric.type = \"cloudsql.googleapis.com/database/postgresql/num_backends\""
      comparison      = "COMPARISON_GT"
      threshold_value = 80
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

# ── Cloud Run alerts (production service) ────────────────────────────────────

resource "google_monitoring_alert_policy" "run_instance_count" {
  display_name = "Cloud Run hitting max instances"
  combiner     = "OR"

  conditions {
    display_name = "Instance count at max"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"labaid-backend\" AND metric.type = \"run.googleapis.com/container/instance_count\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "run_5xx_errors" {
  display_name = "Cloud Run 5xx error rate > 5%"
  combiner     = "OR"

  conditions {
    display_name = "Server error rate high"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"labaid-backend\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"

      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

resource "google_monitoring_alert_policy" "run_latency" {
  display_name = "Cloud Run latency > 5s (p95)"
  combiner     = "OR"

  conditions {
    display_name = "Request latency high"

    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"labaid-backend\" AND metric.type = \"run.googleapis.com/request_latencies\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5000
      duration        = "300s"

      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis]
}

# ── Backup failure monitoring ────────────────────────────────────────────────

resource "google_logging_metric" "sql_backup_failure" {
  name   = "cloudsql-backup-failure"
  filter = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:labaid-db-prod\" AND protoPayload.methodName=\"cloudsql.backupRuns.insert\" AND severity>=ERROR"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "sql_backup_failure" {
  display_name = "Cloud SQL backup failed"
  combiner     = "OR"

  conditions {
    display_name = "Backup error detected"

    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND metric.type = \"logging.googleapis.com/user/cloudsql-backup-failure\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"

      aggregations {
        alignment_period   = "86400s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis, google_logging_metric.sql_backup_failure]
}

resource "google_logging_metric" "sql_backup_success" {
  name   = "cloudsql-backup-success"
  filter = "resource.type=\"cloudsql_database\" AND resource.labels.database_id=\"${var.project_id}:labaid-db-prod\" AND protoPayload.methodName=\"cloudsql.backupRuns.insert\" AND severity<ERROR"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "sql_backup_absent" {
  display_name = "Cloud SQL backup missing (no backup in 26h)"
  combiner     = "OR"

  conditions {
    display_name = "No successful backup in 26 hours"

    condition_absent {
      filter   = "resource.type = \"cloudsql_database\" AND metric.type = \"logging.googleapis.com/user/cloudsql-backup-success\""
      duration = "93600s"

      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]

  alert_strategy {
    auto_close = "1800s"
  }

  depends_on = [google_project_service.apis, google_logging_metric.sql_backup_success]
}
