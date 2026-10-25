output "load_balancer_ip" {
  description = "Origin address for the Cloudflare DNS records (proxied)."
  value       = google_compute_global_address.lb.address
}

output "dns_authorizations" {
  description = "CNAME records Cloudflare must serve (not proxied) for the origin certificate."
  value = {
    for key, auth in google_certificate_manager_dns_authorization.hosts : key => {
      name = trimsuffix(auth.dns_resource_record[0].name, ".")
      type = auth.dns_resource_record[0].type
      data = trimsuffix(auth.dns_resource_record[0].data, ".")
    }
  }
}

output "egress_ips" {
  description = "Fixed outbound addresses to give payment providers and suppliers for allowlists."
  value       = google_compute_address.egress[*].address
}

output "artifact_registry" {
  description = "Image repository: <region>-docker.pkg.dev/<project>/suskii."
  value       = "${google_artifact_registry_repository.images.location}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}

output "deployer_service_account" {
  description = "GitHub Actions identity (environment variable GCP_DEPLOYER_SERVICE_ACCOUNT)."
  value       = google_service_account.deployer.email
}

output "workload_identity_provider" {
  description = "GitHub Actions provider (environment variable GCP_WORKLOAD_IDENTITY_PROVIDER)."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "documents_bucket" {
  value = google_storage_bucket.documents.name
}

output "documents_service_account" {
  description = "Identity whose HMAC key the API uses for the bucket (created out of band, README)."
  value       = google_service_account.documents.email
}

output "services" {
  description = "Cloud Run service names, once deploy_services is true."
  value = var.deploy_services ? {
    api     = module.api[0].name
    worker  = module.worker[0].name
    web     = module.web[0].name
    admin   = module.admin[0].name
    migrate = google_cloud_run_v2_job.migrate[0].name
    ops     = google_cloud_run_v2_job.ops[0].name
  } : {}
}

output "api_internal_url" {
  description = "API run.app URL, reachable from the VPC only."
  value       = var.deploy_services ? module.api[0].uri : null
}
