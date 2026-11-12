# infra

| Path                            | Contents                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `../docker-compose.yml`         | Local Postgres 16, Redis 7 and Mailpit; `--profile s3` and `--profile av` add object storage and ClamAV                 |
| `../docker-compose.release.yml` | Production-like stack from the release images, for the deploy and rollback rehearsal (`pnpm release:rehearse`, ADR-058) |
| `terraform/`                    | GCP platform (Cloud Run, Cloud SQL, Memorystore, GCS, Secret Manager, load balancer) and the Cloudflare edge (ADR-059)  |
| `helm/suskii/`                  | Optional Helm chart for GKE or EKS, with the same release order (ADR-060)                                               |
| `observability/`                | Grafana dashboards and Prometheus alert rules (ADR-047)                                                                 |

Workflows live in `.github/workflows/`: `ci.yml` (pull requests), `deploy.yml` (staging on every
merge), `release.yml` (production from tags, with approval), `infra.yml` (Terraform and Helm
checks, rollback rehearsal) and the mobile workflows. The AWS mapping is in
`docs/deployment/aws.md`.
