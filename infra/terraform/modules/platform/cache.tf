# Memorystore for Redis 7: private services access, AUTH and in-transit encryption with server
# authentication (clients verify the server against REDIS_TLS_CA). Memorystore generates the AUTH
# string, so it is in the state; the state bucket is private and versioned (README).

resource "google_redis_instance" "main" {
  project                 = var.project_id
  name                    = local.name
  region                  = var.region
  tier                    = var.cache.tier
  memory_size_gb          = var.cache.memory_size_gb
  redis_version           = "REDIS_7_2"
  connect_mode            = "PRIVATE_SERVICE_ACCESS"
  authorized_network      = google_compute_network.vpc.id
  auth_enabled            = true
  transit_encryption_mode = "SERVER_AUTHENTICATION"
  labels                  = local.labels
  redis_configs = {
    # BullMQ needs keys to stay until jobs finish.
    maxmemory-policy = "noeviction"
  }
  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 3
        minutes = 0
      }
    }
  }
  depends_on = [google_service_networking_connection.private_services]
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret = google_secret_manager_secret.app["REDIS_URL"].id
  secret_data_wo = format(
    "rediss://:%s@%s:%d",
    google_redis_instance.main.auth_string,
    google_redis_instance.main.host,
    google_redis_instance.main.port,
  )
  secret_data_wo_version = 1
}

resource "google_secret_manager_secret_version" "redis_tls_ca" {
  secret                 = google_secret_manager_secret.app["REDIS_TLS_CA"].id
  secret_data_wo         = google_redis_instance.main.server_ca_certs[0].cert
  secret_data_wo_version = 1
}
