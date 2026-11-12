# Cloudflare in front of one environment (ADR-059): proxied DNS to the load balancer, TLS to the
# origin verified against its Google-managed certificate (ssl = strict), the origin secret header
# Cloud Armor requires, the managed WAF, and edge rules that mirror the API's own boundaries
# (internal routes never public, the console only from allowed addresses, a coarse sign-in rate
# limit in front of the API's finer limits). Plain http is redirected only for the pages people
# open in a browser; the API refuses it, so a misconfigured client fails instead of sending a
# token in the clear. Zone settings keep HTML untouched: the website's nonce CSP and React
# hydration break if the edge injects scripts or rewrites markup.

locals {
  public_hosts = { for key, host in var.hosts : key => host }
  admin_ips    = length(var.admin_allowed_ips) > 0 ? "{${join(" ", var.admin_allowed_ips)}}" : null
  zone_settings = {
    ssl                      = "strict"
    always_use_https         = "off" # per host instead: redirects for pages, refusal for the API
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    automatic_https_rewrites = "on"
    opportunistic_encryption = "on"
    http3                    = "on"
    websockets               = "on" # ride updates (ADR-052)
    ip_geolocation           = "on" # cf-ipcountry, read by the API (CLIENT_COUNTRY_HEADER)
    browser_check            = "on"
    security_level           = "medium"
    "0rtt"                   = "off" # replayable early data is never worth it for writes
    email_obfuscation        = "off" # injects a script the CSP blocks
    rocket_loader            = "off" # rewrites script tags
    server_side_exclude      = "off" # rewrites markup
    always_online            = "off" # never serve stale booking or account pages
  }
}

resource "cloudflare_zone_setting" "this" {
  for_each   = local.zone_settings
  zone_id    = var.zone_id
  setting_id = each.key
  value      = each.value
}

# Cipher suite allowlist for visitors (plan-dependent; see tls_ciphers).
resource "cloudflare_zone_setting" "ciphers" {
  count      = length(var.tls_ciphers) > 0 ? 1 : 0
  zone_id    = var.zone_id
  setting_id = "ciphers"
  value      = var.tls_ciphers
}

resource "cloudflare_dns_record" "hosts" {
  for_each = local.public_hosts
  zone_id  = var.zone_id
  name     = each.value
  type     = "A"
  content  = var.origin_ip
  proxied  = true
  ttl      = 1
  comment  = "Suskii ${each.key} (Terraform)"
}

# Proxied placeholders: the redirect rule answers before any origin is contacted.
resource "cloudflare_dns_record" "redirects" {
  for_each = toset(var.redirect_hosts)
  zone_id  = var.zone_id
  name     = each.value
  type     = "AAAA"
  content  = "100::"
  proxied  = true
  ttl      = 1
  comment  = "Redirected to ${var.hosts.web} (Terraform)"
}

# Certificate Manager validation; never proxied.
resource "cloudflare_dns_record" "certificate" {
  for_each = var.dns_authorizations
  zone_id  = var.zone_id
  name     = each.value.name
  type     = each.value.type
  content  = each.value.data
  proxied  = false
  ttl      = 300
  comment  = "Origin certificate validation for ${each.key} (Terraform)"
}

# Set on every forwarded request (a client's own value is overwritten).
resource "cloudflare_ruleset" "origin_auth" {
  zone_id     = var.zone_id
  name        = "Suskii origin authentication"
  description = "Adds the header Cloud Armor requires."
  kind        = "zone"
  phase       = "http_request_late_transform"
  rules = [
    {
      ref         = "suskii_origin_auth"
      description = "Origin secret for the load balancer"
      expression  = format("http.host in {%s}", join(" ", [for host in values(local.public_hosts) : "\"${host}\""]))
      action      = "rewrite"
      action_parameters = {
        headers = {
          "x-suskii-origin-auth" = {
            operation = "set"
            value     = var.origin_auth_secret
          }
        }
      }
    },
  ]
}

resource "cloudflare_ruleset" "firewall_custom" {
  zone_id     = var.zone_id
  name        = "Suskii edge rules"
  description = "Boundaries the API also enforces, applied before traffic reaches the origin."
  kind        = "zone"
  phase       = "http_request_firewall_custom"
  rules = concat(
    [
      {
        ref         = "suskii_api_https_only"
        description = "The API answers https only (no redirect that would follow a token sent in the clear)"
        expression  = "(http.host eq \"${var.hosts.api}\" and not ssl)"
        action      = "block"
      },
      {
        ref         = "suskii_trace"
        description = "TRACE and TRACK are never served"
        expression  = "(http.request.method in {\"TRACE\" \"TRACK\"})"
        action      = "block"
      },
      {
        ref         = "suskii_internal_routes"
        description = "Internal routes are for the worker inside the VPC only"
        expression  = "(http.host eq \"${var.hosts.api}\" and starts_with(http.request.uri.path, \"/v1/internal\"))"
        action      = "block"
      },
    ],
    local.admin_ips == null ? [] : [
      {
        ref         = "suskii_admin_addresses"
        description = "Console and admin API only from allowed addresses"
        expression  = "((http.host eq \"${var.hosts.admin}\") or (http.host eq \"${var.hosts.api}\" and starts_with(http.request.uri.path, \"/v1/admin\"))) and not ip.src in ${local.admin_ips}"
        action      = "block"
      },
    ],
  )
}

resource "cloudflare_ruleset" "rate_limit" {
  zone_id     = var.zone_id
  name        = "Suskii edge rate limits"
  description = "Coarse per-address limit on account routes; the API applies finer ones."
  kind        = "zone"
  phase       = "http_ratelimit"
  rules = [
    {
      ref         = "suskii_auth_rate"
      description = "Sign-in, sign-up and recovery"
      expression  = "(http.host eq \"${var.hosts.api}\" and starts_with(http.request.uri.path, \"/v1/auth/\"))"
      action      = "block"
      ratelimit = {
        characteristics     = ["cf.colo.id", "ip.src"]
        period              = 10
        requests_per_period = var.auth_rate_limit
        mitigation_timeout  = 10
      }
    },
  ]
}

# The status route is the one API answer the edge keeps (ADR-087). It follows the API's
# Cache-Control (30 s, stale-if-error for a day), so travellers still see the last status while
# the origin does not answer. Pages are never cached here: their HTML carries a per-request
# CSP nonce.
resource "cloudflare_ruleset" "cache" {
  zone_id     = var.zone_id
  name        = "Suskii cache rules"
  description = "The public status route follows the API's Cache-Control at the edge."
  kind        = "zone"
  phase       = "http_request_cache_settings"
  rules = [
    {
      ref         = "suskii_status_cache"
      description = "Status JSON cached as the API says, served stale while the origin errors"
      expression  = "(http.host eq \"${var.hosts.api}\" and http.request.uri.path eq \"/v1/status\")"
      action      = "set_cache_settings"
      action_parameters = {
        cache       = true
        edge_ttl    = { mode = "respect_origin" }
        browser_ttl = { mode = "respect_origin" }
        serve_stale = { disable_stale_while_updating = false }
      }
    },
  ]
}

resource "cloudflare_ruleset" "managed_waf" {
  count       = var.managed_waf ? 1 : 0
  zone_id     = var.zone_id
  name        = "Suskii managed WAF"
  description = "Cloudflare Managed Ruleset and OWASP Core Ruleset."
  kind        = "zone"
  phase       = "http_request_firewall_managed"
  rules = [
    {
      ref               = "suskii_cloudflare_managed"
      description       = "Cloudflare Managed Ruleset"
      expression        = "true"
      action            = "execute"
      action_parameters = { id = "efb7b8c949ac4650a09736fc376e9aee" }
    },
    {
      ref               = "suskii_owasp_core"
      description       = "Cloudflare OWASP Core Ruleset"
      expression        = "true"
      action            = "execute"
      action_parameters = { id = "4814384a9e5d4991b9815dcfc25d2f1f" }
    },
  ]
}

resource "cloudflare_ruleset" "redirects" {
  zone_id     = var.zone_id
  name        = "Suskii redirects"
  description = "Extra host names to the website, and http to https for the pages people open."
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"
  rules = concat(
    length(var.redirect_hosts) == 0 ? [] : [
      {
        ref         = "suskii_redirect_hosts"
        description = "Permanent redirect to ${var.hosts.web}"
        expression  = format("http.host in {%s}", join(" ", [for host in var.redirect_hosts : "\"${host}\""]))
        action      = "redirect"
        action_parameters = {
          from_value = {
            status_code           = 301
            preserve_query_string = true
            target_url = {
              expression = "concat(\"https://${var.hosts.web}\", http.request.uri.path)"
            }
          }
        }
      },
    ],
    [
      {
        ref         = "suskii_pages_https"
        description = "Website and console over https"
        expression  = "(not ssl and http.host in {\"${var.hosts.web}\" \"${var.hosts.admin}\"})"
        action      = "redirect"
        action_parameters = {
          from_value = {
            status_code           = 301
            preserve_query_string = true
            target_url = {
              expression = "concat(\"https://\", http.host, http.request.uri.path)"
            }
          }
        }
      },
    ],
  )
}
