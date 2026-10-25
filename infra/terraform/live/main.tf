# One environment (staging or production) of Suskii: the GCP platform and its Cloudflare edge.
# Applied by an operator with the environment's variables (README); the pipelines only deploy
# new images and run the migration job (ADR-060).

provider "google" {
  project = var.project_id
  region  = var.region
}

# Token from CLOUDFLARE_API_TOKEN, scoped to this environment's zone (README).
provider "cloudflare" {}

module "platform" {
  source = "../modules/platform"

  project_id                = var.project_id
  environment               = var.environment
  region                    = var.region
  hosts                     = var.hosts
  github_repository         = var.github_repository
  github_environment        = var.environment
  deploy_services           = var.deploy_services
  images                    = var.images
  database                  = var.database
  database_password_version = var.database_password_version
  cache                     = var.cache
  scaling                   = var.scaling
  api_env                   = var.api_env
  worker_env                = var.worker_env
  web_env                   = var.web_env
  extra_secrets             = var.extra_secrets
  allow_mock_providers      = var.allow_mock_providers
  origin_auth_secret        = var.origin_auth_secret
  labels                    = var.labels
}

module "edge" {
  source = "../modules/edge"

  zone_id            = var.cloudflare_zone_id
  hosts              = var.hosts
  redirect_hosts     = var.redirect_hosts
  origin_ip          = module.platform.load_balancer_ip
  dns_authorizations = module.platform.dns_authorizations
  origin_auth_secret = var.origin_auth_secret
  admin_allowed_ips  = var.admin_allowed_ips
  managed_waf        = var.managed_waf
}
