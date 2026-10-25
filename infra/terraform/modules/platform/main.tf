# One environment of Suskii on GCP (ADR-059): Cloud Run for the API, worker, website and console,
# Cloud SQL for PostgreSQL, Memorystore for Redis, a private GCS bucket for documents, Artifact
# Registry for images, Secret Manager for every secret, and a global HTTPS load balancer that only
# Cloudflare may reach. Everything private stays private: no public IPs on data services, Cloud
# Run reachable only through the load balancer or the VPC.

locals {
  name   = "suskii-${var.environment}"
  labels = merge(var.labels, { app = "suskii", environment = var.environment, managed-by = "terraform" })
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "certificatemanager.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}
