# The backend on Google Cloud without the edge (ADR-110): the API on its own run.app address,
# the worker and the agent service reachable from the VPC only, Cloud SQL, Memorystore, the
# documents bucket, Artifact Registry, Secret Manager and one identity per service. The same
# platform module as `live/`, with edge = "none": no load balancer, no Cloudflare, no website
# and no console. Those come with the owner's domain, by moving this project to `live/`.
#
# Applied by scripts/gcp/deploy-backend.sh from Cloud Shell, as the owner.

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  # The assistant is on once its service has an address the API can be given (two applies:
  # the services name each other). AGENT_ENABLED is still a setting: `assistant_enabled`.
  assistant = var.deploy_agent && var.agent_url != ""
}

module "platform" {
  source = "../modules/platform"

  project_id         = var.project_id
  environment        = var.environment
  region             = var.region
  edge               = "none"
  hosts              = var.hosts
  github_repository  = var.github_repository
  github_environment = var.environment
  deploy_services    = var.deploy_services
  deploy_agent       = var.deploy_agent
  agent_url          = var.agent_url
  database           = var.database
  cache              = var.cache
  scaling            = var.scaling
  worker_env         = var.worker_env
  extra_secrets      = var.extra_secrets
  labels             = var.labels

  # This environment runs on the built-in stand-ins for suppliers, payments, email and texts
  # until the owner has accounts with the real ones: each is a setting below and a key in
  # Secret Manager away. Production refuses the stand-ins unless this is true.
  allow_mock_providers = var.allow_mock_providers

  api_env = merge(
    {
      FLIGHT_SUPPLIERS          = "mock"
      HOTEL_SUPPLIERS           = "mock"
      PAYMENT_PROVIDERS         = "mock"
      TAX_SELLER_COUNTRY        = "NG"
      EMAIL_PROVIDER            = "mock"
      PUSH_PROVIDER             = "mock"
      ANTIVIRUS_PROVIDER        = "mock"
      DEVICE_ATTESTATION        = "mock"
      LLM_PROVIDER              = "mock"
      AI_SEARCH_ENABLED         = "false"
      SUPPORT_ASSISTANT_ENABLED = "false"
      ADMIN_IP_ALLOWLIST        = ""
      OPS_ALERT_EMAIL           = ""
    },
    # The API never waits on the assistant: with this off, or the service unreachable, every
    # search, booking and payment route answers as before and the clients show no button.
    local.assistant ? { AGENT_ENABLED = tostring(var.assistant_enabled) } : {},
    var.api_env,
  )

  agent_env = merge(
    var.assistant_model == "mock" ? {
      AGENT_MODEL_PROVIDER = "mock"
      ALLOW_MOCK_PROVIDERS = "true"
      } : {
      AGENT_MODEL_PROVIDER = var.assistant_model
    },
    var.agent_env,
  )
}
