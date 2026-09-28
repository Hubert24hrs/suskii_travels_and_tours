# infra

| Path                    | Phase | Contents                                                                                                  |
| ----------------------- | ----- | --------------------------------------------------------------------------------------------------------- |
| `../docker-compose.yml` | 0     | Local Postgres 16, Redis 7 and Mailpit (kept at the repo root so `docker compose up` works without flags) |
| `terraform/`            | 12    | Cloud infrastructure (default GCP Cloud Run + Cloud SQL + Memorystore; AWS equivalent documented)         |
| `helm/`                 | 12    | Optional Helm chart for GKE/EKS                                                                           |
| `github/`               | 12    | Reusable GitHub Actions workflows (deploy, EAS build/submit)                                              |

The PR CI workflow lives in `.github/workflows/ci.yml`.
