# Checks from outside the platform (ADR-087): the website, the API's readiness and the status
# route, requested through the Cloudflare edge from three continents every minute, as travellers
# reach them. When everything is down the Prometheus alerts go quiet (nothing reports); these
# still fire. A check alerts when it fails from two regions for two minutes, so one checker's bad
# network never pages.

locals {
  name = "suskii-${var.environment}"
  checks = {
    website = { host = var.hosts.web, path = "/", content = null }
    api     = { host = var.hosts.api, path = "/ready", content = "\"status\":\"ok\"" }
    status  = { host = var.hosts.api, path = "/v1/status", content = "\"components\"" }
  }
  channels = concat(
    [for channel in google_monitoring_notification_channel.email : channel.id],
    var.notification_channels,
  )
}

resource "google_project_service" "monitoring" {
  project            = var.project_id
  service            = "monitoring.googleapis.com"
  disable_on_destroy = false
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "${local.name} uptime: ${each.value}"
  type         = "email"
  labels       = { email_address = each.value }
  user_labels  = var.labels

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_uptime_check_config" "checks" {
  for_each         = local.checks
  project          = var.project_id
  display_name     = "${local.name}-${each.key}"
  period           = "60s"
  timeout          = "10s"
  selected_regions = var.regions

  http_check {
    path           = each.value.path
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
    accepted_response_status_codes {
      status_class = "STATUS_CLASS_2XX"
    }
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = each.value.host
    }
  }

  dynamic "content_matchers" {
    for_each = each.value.content == null ? [] : [each.value.content]
    content {
      content = content_matchers.value
      matcher = "CONTAINS_STRING"
    }
  }

  depends_on = [google_project_service.monitoring]
}

resource "google_monitoring_alert_policy" "uptime" {
  for_each     = local.checks
  project      = var.project_id
  display_name = "${local.name}-${each.key} unreachable"
  combiner     = "OR"
  severity     = "CRITICAL"
  user_labels  = var.labels

  conditions {
    display_name = "${each.key} fails from two or more regions"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.checks[each.key].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
      trigger {
        count = 1
      }
    }
  }

  notification_channels = local.channels

  alert_strategy {
    auto_close = "1800s"
  }

  documentation {
    mime_type = "text/markdown"
    content   = "https://${each.value.host}${each.value.path} fails from two or more checker regions. Follow docs/runbooks/slo-burn.md and open an incident on the status page."
  }
}
