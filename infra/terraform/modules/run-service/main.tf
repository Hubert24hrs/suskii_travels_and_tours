# One Cloud Run service with the platform's defaults (ADR-059): Direct VPC egress for all traffic,
# secrets from Secret Manager, startup and liveness probes, never directly public. Terraform owns
# the configuration; the pipelines own the image and the traffic split (ADR-060), so those are
# ignored after creation and an apply never rolls a deployment back.

resource "google_cloud_run_v2_service" "this" {
  project              = var.project_id
  location             = var.region
  name                 = var.name
  ingress              = var.ingress
  invoker_iam_disabled = var.public
  deletion_protection  = var.deletion_protection
  labels               = var.labels

  scaling {
    min_instance_count = var.min_instances
    max_instance_count = var.max_instances
  }

  template {
    service_account                  = var.service_account
    max_instance_request_concurrency = var.concurrency
    timeout                          = var.request_timeout
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    labels                           = var.labels

    vpc_access {
      egress = "ALL_TRAFFIC"
      network_interfaces {
        network    = var.network.network
        subnetwork = var.network.subnetwork
        tags       = var.network.tags
      }
    }

    dynamic "volumes" {
      for_each = var.cloud_sql_instance == null ? [] : [var.cloud_sql_instance]
      content {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [volumes.value]
        }
      }
    }

    containers {
      image = var.image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle          = !var.always_on_cpu
        startup_cpu_boost = true
      }

      dynamic "env" {
        for_each = var.env
        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secrets
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }

      dynamic "volume_mounts" {
        for_each = var.cloud_sql_instance == null ? [] : ["cloudsql"]
        content {
          name       = volume_mounts.value
          mount_path = "/cloudsql"
        }
      }

      startup_probe {
        http_get {
          path = var.startup_path
          port = 8080
        }
        initial_delay_seconds = 2
        period_seconds        = 3
        timeout_seconds       = 3
        failure_threshold     = 40
      }

      liveness_probe {
        http_get {
          path = var.liveness_path
          port = 8080
        }
        period_seconds    = 15
        timeout_seconds   = 3
        failure_threshold = 4
      }
    }
  }

  lifecycle {
    ignore_changes = [
      client,
      client_version,
      template[0].containers[0].image,
      template[0].revision,
      traffic,
    ]
  }
}
