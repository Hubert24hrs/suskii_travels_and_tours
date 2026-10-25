# The four services and the migration job (created once deploy_services is true). Public services
# accept traffic only from the load balancer; the worker only from the VPC. Every revision sends
# all its traffic through the VPC, so calls to the API's run.app URL stay internal and outbound
# calls leave from the NAT addresses.

locals {
  network = {
    network    = google_compute_network.vpc.id
    subnetwork = google_compute_subnetwork.run.id
  }
  origins = { for name, host in var.hosts : name => "https://${host}" }

  # Overridable defaults, then the operator's settings, then what the platform fixes.
  api_env = merge(
    {
      LOG_LEVEL         = "info"
      OTEL_SERVICE_NAME = "suskii-api"
    },
    var.api_env,
    {
      NODE_ENV                  = "production"
      API_PORT                  = "8080"
      ALLOW_MOCK_PROVIDERS      = tostring(var.allow_mock_providers)
      SENTRY_ENVIRONMENT        = var.environment
      DATABASE_ALLOW_PLAINTEXT  = "true" # Cloud SQL socket: the connector encrypts the hop
      CLIENT_IP_HEADER          = "cf-connecting-ip"
      CLIENT_COUNTRY_HEADER     = "cf-ipcountry"
      COOKIE_SECURE             = "true"
      WEB_APP_URL               = local.origins.web
      CORS_ORIGINS              = join(",", [local.origins.web, local.origins.admin])
      ADMIN_ORIGINS             = local.origins.admin
      OBJECT_STORAGE            = "s3"
      OBJECT_STORAGE_ENDPOINT   = "https://storage.googleapis.com"
      OBJECT_STORAGE_REGION     = "auto"
      OBJECT_STORAGE_PATH_STYLE = "true"
      OBJECT_STORAGE_BUCKET     = google_storage_bucket.documents.name
    },
  )
}

module "api" {
  count  = var.deploy_services ? 1 : 0
  source = "../run-service"

  project_id          = var.project_id
  region              = var.region
  name                = "${local.name}-api"
  image               = var.images.api
  service_account     = google_service_account.runtime["api"].email
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public              = true
  env                 = local.api_env
  secrets             = local.secret_readers.api
  min_instances       = var.scaling.api.min
  max_instances       = var.scaling.api.max
  memory              = "1Gi"
  concurrency         = 200
  request_timeout     = "3600s" # ride WebSockets (ADR-052) reconnect after this
  startup_path        = "/ready"
  liveness_path       = "/health"
  cloud_sql_instance  = google_sql_database_instance.main.connection_name
  network             = local.network
  labels              = local.labels
  deletion_protection = var.environment == "production"

  depends_on = [
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.sql_clients,
    google_project_iam_member.telemetry,
    google_compute_router_nat.nat,
  ]
}

module "worker" {
  count  = var.deploy_services ? 1 : 0
  source = "../run-service"

  project_id      = var.project_id
  region          = var.region
  name            = "${local.name}-worker"
  image           = var.images.worker
  service_account = google_service_account.runtime["worker"].email
  ingress         = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  public          = false
  env = merge(
    { LOG_LEVEL = "info", OTEL_SERVICE_NAME = "suskii-worker" },
    var.worker_env,
    {
      NODE_ENV           = "production"
      WORKER_HEALTH_PORT = "8080"
      SENTRY_ENVIRONMENT = var.environment
      API_INTERNAL_URL   = module.api[0].uri
    },
  )
  secrets             = local.secret_readers.worker
  min_instances       = var.scaling.worker.min
  max_instances       = var.scaling.worker.max
  memory              = "1Gi"
  always_on_cpu       = true # queues and schedules run between requests
  startup_path        = "/health"
  liveness_path       = "/health"
  network             = local.network
  labels              = local.labels
  deletion_protection = var.environment == "production"

  depends_on = [
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.sql_clients,
    google_project_iam_member.telemetry,
    google_compute_router_nat.nat,
  ]
}

module "web" {
  count  = var.deploy_services ? 1 : 0
  source = "../run-service"

  project_id      = var.project_id
  region          = var.region
  name            = "${local.name}-web"
  image           = var.images.web
  service_account = google_service_account.runtime["web"].email
  ingress         = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public          = true
  env = merge(var.web_env, {
    HOSTNAME         = "0.0.0.0"
    API_INTERNAL_URL = module.api[0].uri
  })
  min_instances       = var.scaling.web.min
  max_instances       = var.scaling.web.max
  memory              = "1Gi"
  request_timeout     = "60s"
  startup_path        = "/robots.txt"
  liveness_path       = "/robots.txt"
  network             = local.network
  labels              = local.labels
  deletion_protection = var.environment == "production"

  depends_on = [
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.sql_clients,
    google_project_iam_member.telemetry,
    google_compute_router_nat.nat,
  ]
}

module "admin" {
  count  = var.deploy_services ? 1 : 0
  source = "../run-service"

  project_id          = var.project_id
  region              = var.region
  name                = "${local.name}-admin"
  image               = var.images.admin
  service_account     = google_service_account.runtime["admin"].email
  ingress             = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"
  public              = true
  env                 = { HOSTNAME = "0.0.0.0" } # the console calls the API from the browser only
  min_instances       = var.scaling.admin.min
  max_instances       = var.scaling.admin.max
  memory              = "512Mi"
  request_timeout     = "60s"
  startup_path        = "/sign-in"
  liveness_path       = "/sign-in"
  network             = local.network
  labels              = local.labels
  deletion_protection = var.environment == "production"

  depends_on = [
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.sql_clients,
    google_project_iam_member.telemetry,
    google_compute_router_nat.nat,
  ]
}

# The database step of every release (migrations, then the reference seed), run by the pipeline
# before a new API revision takes traffic (ADR-060). It reads only DATABASE_URL.
resource "google_cloud_run_v2_job" "migrate" {
  count               = var.deploy_services ? 1 : 0
  project             = var.project_id
  location            = var.region
  name                = "${local.name}-migrate"
  deletion_protection = var.environment == "production"
  labels              = local.labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.runtime["migrate"].email
      max_retries     = 0
      timeout         = "900s"

      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = local.network.network
          subnetwork = local.network.subnetwork
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image = var.images.migrate

        env {
          name  = "NODE_ENV"
          value = "production"
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app["DATABASE_URL"].secret_id
              version = "latest"
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version, template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.sql_clients,
    google_project_iam_member.telemetry,
    google_compute_router_nat.nat,
  ]
}

# Operator commands inside the VPC with the API's identity and settings, on the migrate image
# (which carries the scripts): the first super admin, incident sign-outs, key re-encryption.
#   gcloud run jobs execute suskii-<environment>-ops --wait \
#     --args=scripts/staff-bootstrap.ts,--email,owner@example.com,--yes
# Executions are logged in Cloud Audit Logs; the scripts audit what they change.
resource "google_cloud_run_v2_job" "ops" {
  count               = var.deploy_services ? 1 : 0
  project             = var.project_id
  location            = var.region
  name                = "${local.name}-ops"
  deletion_protection = var.environment == "production"
  labels              = local.labels

  template {
    task_count  = 1
    parallelism = 1

    template {
      service_account = google_service_account.runtime["api"].email
      max_retries     = 0
      timeout         = "3600s"

      vpc_access {
        egress = "ALL_TRAFFIC"
        network_interfaces {
          network    = local.network.network
          subnetwork = local.network.subnetwork
        }
      }

      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }

      containers {
        image   = var.images.migrate
        command = ["node_modules/.bin/tsx"]
        args    = ["scripts/staff-bootstrap.ts"] # prints the usage; executions pass their own

        dynamic "env" {
          for_each = local.api_env
          content {
            name  = env.key
            value = env.value
          }
        }

        dynamic "env" {
          for_each = local.secret_readers.api
          content {
            name = env.value
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.app[env.value].secret_id
                version = "latest"
              }
            }
          }
        }

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }

        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version, template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_secret_manager_secret_iam_member.readers,
    google_project_iam_member.sql_clients,
    google_compute_router_nat.nat,
  ]
}
