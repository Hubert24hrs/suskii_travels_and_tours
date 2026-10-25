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

# Egress policy for every Cloud Run revision and job (tagged): HTTPS and SMTP over TLS to the
# internet, anything inside the VPC and private services (Cloud SQL's connector on 3307, Redis on
# 6378, a private ClamAV or OSRM), nothing else. Providers sit behind CDNs whose addresses change,
# so the policy is by port; names are pinned in the applications' settings instead.
locals {
  run_tag = "${local.name}-run"
  internal_ranges = [
    google_compute_subnetwork.run.ip_cidr_range,
    "${google_compute_global_address.private_services.address}/${google_compute_global_address.private_services.prefix_length}",
  ]
}

resource "google_compute_firewall" "egress_internal" {
  project            = var.project_id
  name               = "${local.name}-egress-internal"
  network            = google_compute_network.vpc.id
  direction          = "EGRESS"
  priority           = 1000
  target_tags        = [local.run_tag]
  destination_ranges = local.internal_ranges
  allow {
    protocol = "all"
  }
}

# Trivy flags any internet-wide allow (GCP-0035). Port-based egress is the accepted partial for
# ASVS V13.2.5 until the owner chooses name-based filtering (Secure Web Proxy or Cloud NGFW
# Enterprise); the expiry makes the scan fail again so the decision is reviewed.
#trivy:ignore:GCP-0035:exp:2027-04-30
resource "google_compute_firewall" "egress_internet" {
  project            = var.project_id
  name               = "${local.name}-egress-internet"
  network            = google_compute_network.vpc.id
  direction          = "EGRESS"
  priority           = 1100
  target_tags        = [local.run_tag]
  destination_ranges = ["0.0.0.0/0"]
  allow {
    protocol = "tcp"
    ports    = ["443", "465", "587"]
  }
}

resource "google_compute_firewall" "egress_deny" {
  project            = var.project_id
  name               = "${local.name}-egress-deny"
  network            = google_compute_network.vpc.id
  direction          = "EGRESS"
  priority           = 65000
  target_tags        = [local.run_tag]
  destination_ranges = ["0.0.0.0/0"]
  deny {
    protocol = "all"
  }
  log_config {
    metadata = "EXCLUDE_ALL_METADATA"
  }
}
