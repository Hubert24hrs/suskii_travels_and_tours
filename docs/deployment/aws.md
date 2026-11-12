# Running Suskii on AWS

GCP is the default cloud (ADR-059) and the only one with Terraform in this repository. This page
maps every part of that setup to its AWS equivalent, so a move or a second region on AWS keeps the
same security properties. The application needs no code change: object storage is already the S3
API (ADR-057), Redis TLS takes a CA (`REDIS_TLS_CA`), and the client address comes from the edge's
header (`CLIENT_IP_HEADER`).

## Mapping

| GCP (ADR-059)                                             | AWS                                                                                             | Notes                                                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One project per environment                               | One account per environment, in an AWS Organization                                             | Service control policies deny leaving the region and disabling CloudTrail                                                                                                                               |
| Cloud Run services (API, web, console, worker)            | ECS on Fargate services behind an ALB; or EKS with the Helm chart (`infra/helm/suskii`)         | Fargate tasks with `readonlyRootFilesystem`, a non-root user and a tmpfs `/tmp`, as in the compose rehearsal. App Runner lacks VPC-only ingress control for the worker                                  |
| Cloud Run jobs (migrate, ops)                             | ECS `RunTask` with the migrate image's task definition                                          | The pipeline runs the migrate task and waits for exit code 0 before updating services                                                                                                                   |
| Direct VPC egress + Cloud NAT (two fixed addresses)       | Private subnets + NAT gateways with Elastic IPs (one per AZ)                                    | Give the Elastic IPs to payment providers and suppliers                                                                                                                                                 |
| VPC firewall egress rules (443, 465, 587; VPC; deny rest) | Security groups on the tasks (egress 443, 465, 587 to 0.0.0.0/0; 5432 and 6379 to the data SGs) | Name-based egress: AWS Network Firewall with domain lists                                                                                                                                               |
| Cloud SQL for PostgreSQL 16, private IP, PITR, HA         | RDS for PostgreSQL 16 (Multi-AZ in production), private subnets, automated backups, PITR        | `rds.force_ssl = 1`; the app connects with `sslmode=verify-full` and the RDS CA bundle (no `DATABASE_ALLOW_PLAINTEXT`)                                                                                  |
| Two database roles (`suskii_migrator`, `suskii_app`)      | The RDS master user only bootstraps `suskii_migrator`; the release step creates `suskii_app`    | Same `DATABASE_URL` / `DATABASE_APP_URL` split and the same checks (`apps/api/src/infra/app-role.ts`)                                                                                                   |
| Memorystore for Redis 7.2, AUTH + TLS                     | ElastiCache for Redis OSS 7 (or Valkey), in-transit encryption, AUTH token, Multi-AZ            | `rediss://` URL; `REDIS_TLS_CA` is not needed (Amazon's certificates chain to public roots)                                                                                                             |
| GCS bucket via the S3 API with an HMAC key                | S3 bucket: block public access, versioning, SSE-KMS, lifecycle for old versions                 | `OBJECT_STORAGE_ENDPOINT=https://s3.<region>.amazonaws.com`, real region, virtual-hosted style. Keys: an IAM user limited to the bucket, or task-role credentials once the adapter reads them (ADR-057) |
| Artifact Registry, immutable tags                         | ECR with tag immutability and scan on push                                                      | Images are promoted by digest exactly as on GCP                                                                                                                                                         |
| Secret Manager, per-service access, audited reads         | Secrets Manager (or SSM Parameter Store SecureString), referenced in task definitions           | One task execution role per service, allowed only its secrets; CloudTrail data events record reads                                                                                                      |
| Service accounts per service                              | IAM task roles and task execution roles per service                                             | The deployer role cannot change IAM, networking or data services                                                                                                                                        |
| Workload Identity Federation for GitHub                   | IAM OIDC provider for `token.actions.githubusercontent.com`                                     | Trust policy conditions on `repo:Hubert24hrs/suskii_travels_and_tours:environment:<env>`                                                                                                                |
| Global external ALB + Certificate Manager                 | ALB with an ACM certificate (DNS-validated through Cloudflare)                                  | HTTPS listener only, `ELBSecurityPolicy-TLS13-1-2-Res-2021-06` (AEAD only)                                                                                                                              |
| Cloud Armor: Cloudflare ranges + origin secret            | AWS WAF on the ALB: an IP set of Cloudflare ranges and a rule requiring `x-suskii-origin-auth`  | Default action block, so a missing header fails closed; the Cloudflare edge module is unchanged                                                                                                         |
| Cloud Run ingress "internal and load balancing"           | Tasks in private subnets; the ALB's security group is the only inbound source                   | The worker has no inbound rule at all                                                                                                                                                                   |
| Cloud Logging, `_Default` retention                       | CloudWatch Logs groups per service with retention; S3 export for long-term                      | Logs are already JSON on stdout                                                                                                                                                                         |
| Cloud Monitoring and Trace                                | CloudWatch metrics or Amazon Managed Prometheus; X-Ray through an OTLP collector sidecar        | The dashboards and alert rules in `infra/observability` are Prometheus-based (ADR-047)                                                                                                                  |

## Order of work for an AWS environment

1. **Accounts and baseline.** An account per environment, CloudTrail organisation trail,
   GuardDuty, an S3 state bucket with DynamoDB locking.
2. **Network and data.** VPC with public and private subnets in three AZs, NAT gateways, RDS,
   ElastiCache, the documents bucket, ECR.
3. **Secrets.** Secrets Manager entries named as on GCP (`DATABASE_URL`, `DATABASE_MIGRATION_URL`,
   `REDIS_URL`, `JWT_PRIVATE_KEY`, ...), values added by an operator.
4. **Compute.** Task definitions for the five images, services for API, worker, web and console,
   an ALB with host-based rules, AWS WAF, and the migrate and ops task definitions.
5. **Pipeline.** The workflows (ADR-060) keep their shape; replace the `gcloud` steps with
   `aws ecs run-task` (migrate), `aws ecs update-service` (deploy) and a CodeDeploy blue/green
   deployment group if a weighted canary is wanted. Rollback is `update-service` back to the
   previous task definition revision.
6. **Edge.** The Cloudflare module is reused as is, pointed at the ALB's DNS name (CNAME,
   proxied) instead of an address.

## What does not carry over

- **Cloud Run's built-in Cloud SQL socket.** On AWS the database hop is TLS with certificate
  verification, which is stricter, so `DATABASE_ALLOW_PLAINTEXT` stays false.
- **Per-request billing and scale to zero for staging.** Fargate services keep at least one task.
  Use scheduled scaling to zero outside working hours for staging if cost matters.
