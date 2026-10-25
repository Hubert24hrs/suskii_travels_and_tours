# A private VPC: Cloud Run sends all its traffic through it (Direct VPC egress), so service-to-
# service calls stay internal and outbound calls leave through Cloud NAT from fixed addresses
# (payment and supplier allowlists). Cloud SQL and Memorystore sit on private services access.

resource "google_compute_network" "vpc" {
  project                 = var.project_id
  name                    = local.name
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "run" {
  project                  = var.project_id
  name                     = "${local.name}-run"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  ip_cidr_range            = "10.10.0.0/22"
  private_ip_google_access = true
  log_config {
    aggregation_interval = "INTERVAL_5_MIN"
    flow_sampling        = 0.2
    metadata             = "EXCLUDE_ALL_METADATA"
  }
}

resource "google_compute_global_address" "private_services" {
  project       = var.project_id
  name          = "${local.name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

resource "google_compute_router" "nat" {
  project = var.project_id
  name    = "${local.name}-nat"
  region  = var.region
  network = google_compute_network.vpc.id
}

resource "google_compute_address" "egress" {
  count   = 2
  project = var.project_id
  name    = "${local.name}-egress-${count.index}"
  region  = var.region
}

resource "google_compute_router_nat" "nat" {
  project                            = var.project_id
  name                               = "${local.name}-nat"
  router                             = google_compute_router.nat.name
  region                             = var.region
  nat_ip_allocate_option             = "MANUAL_ONLY"
  nat_ips                            = google_compute_address.egress[*].self_link
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  subnetwork {
    name                    = google_compute_subnetwork.run.id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}
