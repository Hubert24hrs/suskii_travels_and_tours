output "load_balancer_ip" {
  value = module.platform.load_balancer_ip
}

output "egress_ips" {
  value = module.platform.egress_ips
}

output "artifact_registry" {
  value = module.platform.artifact_registry
}

output "deployer_service_account" {
  value = module.platform.deployer_service_account
}

output "workload_identity_provider" {
  value = module.platform.workload_identity_provider
}

output "documents_bucket" {
  value = module.platform.documents_bucket
}

output "documents_service_account" {
  value = module.platform.documents_service_account
}

output "services" {
  value = module.platform.services
}

output "api_internal_url" {
  value = module.platform.api_internal_url
}
