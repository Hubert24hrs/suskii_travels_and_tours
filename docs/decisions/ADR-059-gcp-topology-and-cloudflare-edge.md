# ADR-059: GCP topology and the Cloudflare edge

- Status: Accepted
- Date: 2026-10-25
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec names GCP Cloud Run, Cloud SQL and Memorystore as the default cloud, with the AWS
equivalent documented, and Cloudflare in front for the WAF. The platform has four processes (API,
worker, website, console), one Postgres, one Redis, private documents and a dozen secrets. Its
rules already demand TLS or a declared private hop to every data service (ADR-038), no mock
provider in production unless declared, and client addresses that cannot be forged (ASVS V4.1.3).

Nothing about the owner's accounts is known yet: no GCP project, Cloudflare zone, domain or
provider keys. So the infrastructure has to be complete and checkable without them, and stop
cleanly where they are needed.

## Decision

Terraform in `infra/terraform`: a `platform` module (GCP), an `edge` module (Cloudflare), a
`run-service` module, and one root (`live/`) applied per environment with its own variables,
state bucket and GitHub environment.

### One project and one Cloudflare zone per environment

- Staging and production share nothing: separate GCP projects, state, secrets and zones.
- Zone settings and phase rulesets are zone-wide in Cloudflare. Two environments in one zone
  would overwrite each other's rules, so staging gets its own (cheap) domain.

### Compute: Cloud Run for all four processes

- API, website and console are request-driven services.
- The worker is a service with CPU always allocated, at least one instance and internal-only
  ingress. It answers only its health probe.
- Cloud Run worker pools fit the worker better but were not used. Their availability and
  Terraform support are newer than the rest of this setup.
- The migration step and operator commands are Cloud Run jobs (`migrate`, `ops`) on the API's
  migrate image.
- Container port 8080 everywhere.
- Startup probes:
  - the API: `/ready` (Postgres and Redis reachable), so a revision that cannot reach its data
    never takes traffic;
  - the worker: `/health`;
  - the website: `/robots.txt`;
  - the console: `/sign-in`.

### Network: one private VPC

- Every revision uses Direct VPC egress for all traffic.
  - Calls to the API's `run.app` URL (from the worker and the website's server) stay inside
    Google's network. The API's ingress takes only the load balancer and the VPC.
  - Outbound calls leave through Cloud NAT from two reserved addresses. Payment providers and
    suppliers can allowlist them (`egress_ips` output).
- Cloud SQL and Memorystore have private addresses only (private services access).

### Data

- **Cloud SQL for PostgreSQL 16.**
  - Private IP, `ENCRYPTED_ONLY`, connector enforcement `REQUIRED`.
  - Automated backups with point-in-time recovery, deletion protection.
  - Regional (HA) in production.
  - The services reach it through Cloud Run's built-in Cloud SQL connection: a Unix socket at
    `/cloudsql`. The connector encrypts the hop and checks the identity's `cloudsql.client`
    role, which is the private, encrypted path `DATABASE_ALLOW_PLAINTEXT` exists for.
  - The application password is an ephemeral value, written only to the SQL user and the
    `DATABASE_URL` secret (write-only arguments). It never enters the state.
  - Rotate it by raising `database_password_version`.
- **Memorystore for Redis 7.2.**
  - Private services access, AUTH and in-transit encryption with server authentication.
  - Clients verify the server certificate against `REDIS_TLS_CA`, written from the instance's
    CA by Terraform. The URL is `rediss://` on port 6378.
  - `noeviction`, because BullMQ needs its keys.
  - Standard HA in production.
  - Memorystore generates the AUTH string, so it sits in the state. The state bucket is private,
    versioned and in the environment's own project.
- **Documents.**
  - A private GCS bucket: uniform access, public access prevention, versioning, old versions
    pruned after 30 days, soft delete.
  - The API reaches it through the S3 API (ADR-057) with an HMAC key of a storage-only
    identity. The key is created out of band, so its secret never enters the state.

### Secrets

- Secret Manager holds every secret, replicated in the region only.
- Terraform creates each secret container. It writes the values it generates itself
  (`DATABASE_URL`, `REDIS_URL`, `REDIS_TLS_CA`) as write-only data. Operators add the rest with
  `gcloud secrets versions add`, so those values never pass through Terraform.
- Each identity reads only what it uses:
  - the API: all of them;
  - the worker: Redis and the internal token;
  - the migrate job: `DATABASE_URL`.
- `api_env` (plain settings) rejects names that look like secrets. Those belong in
  `extra_secrets`.

### Field encryption keys and KMS

- ADR-007 and ADR-038 left a cloud KMS adapter for phase 12. It is not built. On Cloud Run the
  API's identity would need both the wrapped key and the KMS decrypt permission, so whoever holds
  that identity's token gets the key either way. Meanwhile every boot would depend on one more
  service.
- What phase 12 does instead:
  - the keys stay in Secret Manager, readable only by the API's identity;
  - every read is recorded in Data Access audit logs (`secretmanager.googleapis.com`,
    `DATA_READ`);
  - rotation keeps the key ring and `keys:reencrypt` from ADR-038.
- Customer-managed encryption keys (CMEK) for Secret Manager, Cloud SQL and the bucket are an
  owner option. They add key custody and crypto-shredding, not a different access path. Each
  needs its key before the resource is created, so decide before the first production apply.

### Identities

- One service account per service and job.
- Only the API and the migrate job have `cloudsql.client`.
- GitHub Actions deploys as a `deployer` identity through Workload Identity Federation, so no
  service account keys exist. The provider accepts tokens only from this repository and the
  matching GitHub environment, and the environment's protection rules (reviewers) gate them.
- The deployer can deploy Cloud Run revisions and push images. It cannot change IAM, the
  network or data services. Terraform is applied by an operator.

### Edge: Cloudflare, then the load balancer, then Cloud Run

- **Cloudflare** terminates TLS for visitors and runs the managed WAF (Cloudflare Managed and
  OWASP Core rulesets on Pro and above). It also runs custom rules:
  - `/v1/internal` is blocked;
  - the console and `/v1/admin` are blocked outside `admin_allowed_ips`;
  - a coarse rate limit sits on `/v1/auth/`.
- **Zone settings** keep HTML untouched (Rocket Loader, email obfuscation and server-side
  excludes off), because the website's nonce CSP and React hydration break otherwise. They also
  set:
  - `ssl = strict` and TLS 1.2 minimum;
  - WebSockets on, for ride updates;
  - IP geolocation on, for `cf-ipcountry`;
  - 0-RTT off.
- **The load balancer** is a global external Application Load Balancer.
  - It serves a Google-managed certificate. Certificate Manager validates it through DNS records
    the edge module creates, which works while traffic is proxied.
  - It listens on 443 only, with a MODERN TLS policy.
- **Cloud Armor** admits a request only when it comes from Cloudflare's published ranges _and_
  carries the zone's origin secret in `x-suskii-origin-auth`. A Cloudflare transform rule sets
  that header on every forwarded request and overwrites any value a client sent. Without the
  secret, anyone with their own Cloudflare account could point it at the load balancer and skip
  this zone's WAF.
  - The rules allow, and everything else is denied. A missing header therefore fails closed.
  - Each rule holds the secret check plus four ranges, within Cloud Armor's five-subexpression
    limit.
- **Cloud Run ingress** is "internal and load balancing". `run.app` URLs refuse traffic from the
  internet.

### Client addresses

- Behind this edge the API sets `CLIENT_IP_HEADER=cf-connecting-ip`. It reads the visitor's
  address from Cloudflare's header and discards `X-Forwarded-For`. That header cannot be forged,
  because only this zone's Cloudflare traffic reaches the origin.
- This replaces counting proxy hops (`TRUST_PROXY_HOPS`). The load balancer appends its own
  entries to `X-Forwarded-For`, so a wrong hop count would either let clients choose their
  address or put every visitor behind one Cloudflare address.
- The two settings are mutually exclusive in the env schema. An e2e test proves a forged
  `X-Forwarded-For` is ignored.
- The website's server-side reads come from the website service's own address. They are all
  cached in the Next.js data cache (`revalidate` of a minute or more), so their volume stays well
  inside the per-address limits.

### Region

- The default is `europe-west2` (London), the main route out of Lagos for most Nigerian
  networks. Cloudflare's Lagos and Abuja locations serve static assets either way.
- `africa-south1` (Johannesburg) is a variable change once every service used here is available
  there and latency from Nigeria is measured.

### Applying

- The first apply (`deploy_services = false`) creates the foundations:
  - network, database, cache, bucket and registry;
  - secret containers, identities, certificate and DNS.
- The operator then adds secret values and pushes the first images.
- The second apply (`deploy_services = true`) creates the services, jobs and load balancer.
- From then on the pipelines own images and traffic (ADR-060). Terraform ignores both, so an
  apply never rolls a deployment back.

## Consequences

- The configuration is checked in CI without any account: `terraform fmt`, `validate`, TFLint.
  It was also planned offline here (120 resources for production) against the Google provider
  8.6.
  - The Cloudflare provider could not be downloaded in this environment, so the edge module is
    validated only in CI.
  - Nothing has been applied to a real project yet.
- Production cannot start until real adapters exist for SMS, WhatsApp, exchange rates, hotels,
  KYC and payouts. Today those have only mock adapters, and production refuses mocks. Staging
  runs on mocks with `allow_mock_providers`.
- Two domains (staging and production) and, for the managed WAF, Cloudflare Pro on production.
  On the Free plan, set `managed_waf = false`.
- An HMAC key and the origin secret are static secrets with yearly rotation, listed in
  `docs/security/crypto-inventory.md`. The origin secret is rotated by applying a new value to
  both modules in one apply. Cloud Armor and the transform rule then update within seconds of
  each other; a brief window of 403s is possible, so rotate in a quiet hour.
- The AWS mapping (ECS on Fargate or App Runner, RDS, ElastiCache, S3, CloudFront or Cloudflare)
  is in `docs/deployment/aws.md`.
