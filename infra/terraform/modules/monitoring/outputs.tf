output "uptime_check_ids" {
  description = "Cloud Monitoring uptime check ids, by check."
  value       = { for key, check in google_monitoring_uptime_check_config.checks : key => check.uptime_check_id }
}
