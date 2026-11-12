output "name" {
  value = google_cloud_run_v2_service.this.name
}

output "uri" {
  description = "run.app URL; reachable only from the VPC (and the load balancer for public services)."
  value       = google_cloud_run_v2_service.this.uri
}
