# Global external Application Load Balancer, reachable only from Cloudflare (ADR-059):
#   Cloudflare (WAF, TLS for visitors) -> this load balancer (Google-managed certificate, Cloud
#   Armor) -> serverless NEGs -> Cloud Run (ingress: load balancer and VPC only).
# Cloud Armor admits a request only from Cloudflare's ranges AND with the zone's origin secret in
# x-suskii-origin-auth (added by a Cloudflare transform rule), so another Cloudflare account
# pointed at this address gets 403 too. Only 443 listens; Cloudflare redirects http to https
# for the website and console and refuses it for the API.
# The address, certificate and policy exist from the first apply so DNS and the certificate can be
# ready before the services are.

locals {
  # Cloud Armor allows five subexpressions per rule: the secret check plus four ranges.
  cloudflare_rules = chunklist(var.cloudflare_ip_ranges, 4)
  lb_services = var.deploy_services ? {
    api   = module.api[0].name
    web   = module.web[0].name
    admin = module.admin[0].name
  } : {}
}

resource "google_compute_global_address" "lb" {
  project    = var.project_id
  name       = "${local.name}-lb"
  ip_version = "IPV4"
  labels     = local.labels
  depends_on = [google_project_service.apis]
}

# Certificates for the origin, validated through DNS records that the edge module creates in
# Cloudflare (dns_authorizations output), so issuance works while traffic is proxied.
resource "google_certificate_manager_dns_authorization" "hosts" {
  for_each   = var.hosts
  project    = var.project_id
  name       = "${local.name}-${each.key}"
  domain     = each.value
  labels     = local.labels
  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate" "origin" {
  project = var.project_id
  name    = "${local.name}-origin"
  scope   = "DEFAULT"
  labels  = local.labels
  managed {
    domains            = [for key in sort(keys(var.hosts)) : var.hosts[key]]
    dns_authorizations = [for key in sort(keys(var.hosts)) : google_certificate_manager_dns_authorization.hosts[key].id]
  }
}

resource "google_certificate_manager_certificate_map" "origin" {
  project    = var.project_id
  name       = "${local.name}-origin"
  labels     = local.labels
  depends_on = [google_project_service.apis]
}

resource "google_certificate_manager_certificate_map_entry" "hosts" {
  for_each     = var.hosts
  project      = var.project_id
  name         = "${local.name}-${each.key}"
  map          = google_certificate_manager_certificate_map.origin.name
  hostname     = each.value
  certificates = [google_certificate_manager_certificate.origin.id]
  labels       = local.labels
}

resource "google_compute_security_policy" "edge" {
  project     = var.project_id
  name        = "${local.name}-edge"
  description = "Only this zone's Cloudflare traffic reaches the origin."
  type        = "CLOUD_ARMOR"

  dynamic "rule" {
    for_each = local.cloudflare_rules
    content {
      action      = "allow"
      priority    = 1000 + rule.key
      description = "Cloudflare ranges with the origin secret (${rule.key + 1}/${length(local.cloudflare_rules)})"
      match {
        expr {
          expression = format(
            "request.headers['x-suskii-origin-auth'] == '%s' && (%s)",
            var.origin_auth_secret,
            join(" || ", [for range in rule.value : "inIpRange(origin.ip, '${range}')"]),
          )
        }
      }
    }
  }

  rule {
    action      = "deny(403)"
    priority    = 2147483647
    description = "Everything else."
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_compute_ssl_policy" "origin" {
  project         = var.project_id
  name            = "${local.name}-origin"
  profile         = "RESTRICTED" # AEAD suites only (ECDHE with AES-GCM or ChaCha20-Poly1305)
  min_tls_version = "TLS_1_2"
  depends_on      = [google_project_service.apis]
}

resource "google_compute_region_network_endpoint_group" "run" {
  for_each              = local.lb_services
  project               = var.project_id
  name                  = "${local.name}-${each.key}"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = each.value
  }
}

resource "google_compute_backend_service" "run" {
  for_each              = local.lb_services
  project               = var.project_id
  name                  = "${local.name}-${each.key}"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.edge.id
  backend {
    group = google_compute_region_network_endpoint_group.run[each.key].id
  }
  log_config {
    enable      = true
    sample_rate = 1
  }
}

resource "google_compute_url_map" "main" {
  count           = var.deploy_services ? 1 : 0
  project         = var.project_id
  name            = local.name
  default_service = google_compute_backend_service.run["web"].id

  dynamic "host_rule" {
    for_each = local.lb_services
    content {
      hosts        = [var.hosts[host_rule.key]]
      path_matcher = host_rule.key
    }
  }

  dynamic "path_matcher" {
    for_each = local.lb_services
    content {
      name            = path_matcher.key
      default_service = google_compute_backend_service.run[path_matcher.key].id
    }
  }
}

resource "google_compute_target_https_proxy" "main" {
  count           = var.deploy_services ? 1 : 0
  project         = var.project_id
  name            = local.name
  url_map         = google_compute_url_map.main[0].id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.origin.id}"
  ssl_policy      = google_compute_ssl_policy.origin.id
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.deploy_services ? 1 : 0
  project               = var.project_id
  name                  = "${local.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_protocol           = "TCP"
  port_range            = "443"
  ip_address            = google_compute_global_address.lb.id
  target                = google_compute_target_https_proxy.main[0].id
  labels                = local.labels
}
