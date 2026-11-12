output "api_url" {
  description = "The API's public address: what the app is built against."
  value       = module.platform.api_internal_url
}

output "agent_internal_url" {
  description = "The agent service's address, reachable from the VPC only (the agent_url variable)."
  value       = module.platform.agent_internal_url
}

output "services" {
  value = module.platform.services
}

output "artifact_registry" {
  value = module.platform.artifact_registry
}

output "egress_ips" {
  description = "Fixed outbound addresses, for providers that keep an allowlist."
  value       = module.platform.egress_ips
}

output "documents_bucket" {
  value = module.platform.documents_bucket
}

output "documents_service_account" {
  value = module.platform.documents_service_account
}

output "deployer_service_account" {
  description = "GitHub Actions identity (environment variable GCP_DEPLOYER_SERVICE_ACCOUNT)."
  value       = module.platform.deployer_service_account
}

output "workload_identity_provider" {
  description = "GitHub Actions provider (environment variable GCP_WORKLOAD_IDENTITY_PROVIDER)."
  value       = module.platform.workload_identity_provider
}
