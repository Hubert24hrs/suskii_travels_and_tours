# Cloud SQL for PostgreSQL 16: private IP only, connections only through Cloud SQL connectors
# (Cloud Run's built-in socket encrypts and authorises them), automated backups with point-in-time
# recovery, deletion protection. The application password is generated as an ephemeral value and
# written only to the SQL user and the DATABASE_URL secret: it never enters the Terraform state.

resource "google_sql_database_instance" "main" {
  project             = var.project_id
  name                = local.name
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.database.deletion_protection

  settings {
    tier                        = var.database.tier
    edition                     = "ENTERPRISE"
    availability_type           = var.database.availability_type
    disk_type                   = "PD_SSD"
    disk_size                   = var.database.disk_size_gb
    disk_autoresize             = true
    deletion_protection_enabled = var.database.deletion_protection
    connector_enforcement       = "REQUIRED"
    user_labels                 = local.labels

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "01:00"
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.database.log_retention_days
      backup_retention_settings {
        retained_backups = var.database.backup_retention
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7
      hour         = 2
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "suskii" {
  project  = var.project_id
  name     = "suskii"
  instance = google_sql_database_instance.main.name
}

ephemeral "random_password" "database" {
  length  = 40
  special = false
}

resource "google_sql_user" "app" {
  project             = var.project_id
  name                = "suskii_app"
  instance            = google_sql_database_instance.main.name
  password_wo         = ephemeral.random_password.database.result
  password_wo_version = var.database_password_version
}

# The socket of Cloud Run's built-in Cloud SQL connection (DATABASE_ALLOW_PLAINTEXT applies: the
# connector encrypts the hop and checks the caller's IAM role).
resource "google_secret_manager_secret_version" "database_url" {
  secret                 = google_secret_manager_secret.app["DATABASE_URL"].id
  secret_data_wo_version = var.database_password_version
  secret_data_wo = format(
    "postgresql://%s:%s@localhost/%s?host=/cloudsql/%s",
    google_sql_user.app.name,
    ephemeral.random_password.database.result,
    google_sql_database.suskii.name,
    google_sql_database_instance.main.connection_name,
  )
}
