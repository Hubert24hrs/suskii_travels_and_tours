# Helm chart: suskii

The optional Kubernetes deployment (GKE or EKS). Cloud Run (`infra/terraform`) is the default
(ADR-059). The chart keeps the same release order and gates as the pipelines (ADR-060):

1. **Migration hook.** A `pre-install,pre-upgrade` Job runs migrations as the schema owner, the
   reference seed, and the app role step. If it fails, the release stops.
2. **Rolling update.** Deployments with `maxUnavailable: 0`. A new API pod takes traffic only
   once `/ready` answers, meaning Postgres and Redis are reachable.
3. **Automatic rollback.** `helm upgrade --atomic --wait` restores the previous revision when the
   new one does not become ready in time. `helm rollback` goes back by hand. The database stays
   as it is: migrations are expand/contract only.

## Install

The chart never holds secret values. Create these Secrets first (External Secrets Operator, the
cloud's Secret Manager CSI driver, or `kubectl create secret generic`), with keys named after the
environment variables:

| Secret           | Keys                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `suskii-api`     | `DATABASE_URL` (app role), `REDIS_URL`, `REDIS_TLS_CA`, `JWT_*`, `FIELD_ENCRYPTION_KEY`, `HMAC_SECRET`, `INTERNAL_API_TOKEN`, `TURNSTILE_SECRET_KEY`, `CARS_TICKET_SIGNING_KEY`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, provider keys |
| `suskii-migrate` | `DATABASE_URL` (schema owner), `DATABASE_APP_URL` (app role)                                                                                                                                                                                                       |
| `suskii-worker`  | `REDIS_URL`, `REDIS_TLS_CA`, `INTERNAL_API_TOKEN`                                                                                                                                                                                                                  |

```bash
helm upgrade --install suskii infra/helm/suskii -n suskii --create-namespace \
  -f values-<environment>.yaml --atomic --wait --timeout 10m
```

## The agent service

Off by default (`agent.enabled: false`). It is the assistant's own service (ADR-101): the API
starts its runs, and its one way into the platform is the API's tool gateway.

1. Create the Secret `suskii-agent` with `AGENT_RUN_TOKEN`, `AGENT_TOOLS_TOKEN` (two different
   values, neither the worker's token; the API's Secret holds the same two), `AGENT_DATABASE_URL`
   (a role of its own, for example `suskii_agent`) and `LLM_API_KEY`.
2. Add `DATABASE_AGENT_URL`, the same URL, to `suskii-migrate`: the migration hook creates the
   role and limits it to the `agent` schema (ADR-103).
3. Set `agent.enabled: true` and the models in `agent.env`, then upgrade. The pod is ready once
   that role reads its checkpoint tables.
4. Point the API at it: `api.env.AGENT_URL: http://<release>-agent` (with `AGENT_ALLOW_PLAINTEXT`
   only under a mesh). The assistant still answers nobody until `AGENT_ENABLED` is set, which
   is the owner's decision after the agent evals have run against the model (ADR-106).

Its network policy lets in the API only, and lets out DNS, the API, the data services' CIDRs
and HTTPS (the model provider). It has no Ingress. The kind rehearsal does not include it; the
compose rehearsal does.

## What the chart enforces

- **Pod hardening.** Non-root (uid 1000), read-only root file system, no privilege escalation,
  every capability dropped, `RuntimeDefault` seccomp. No service account tokens.
- **Network policies.** Deny by default. The ingress controller reaches the public services; the
  worker and website reach the API; egress is DNS, the data services' CIDRs, and HTTPS or SMTP to
  the internet. The agent service, when enabled, is reached by the API alone.
- **Plain settings guard.** `*.env` values refuse keys the chart sets itself and names that look
  like secrets.
- **Encrypted internal traffic.** The worker refuses plain http to the API in production. Set
  `meshMtls: true` only when a service mesh encrypts and authenticates pod-to-pod traffic.
- **Client address.** `api.clientIpHeader` is set when the ingress accepts nothing but the
  edge's traffic (Cloudflare: `cf-connecting-ip`); otherwise set `api.trustProxyHops`.

## Checks

| Where | What                                                                                                                              |
| ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| CI    | `helm lint --strict`, `helm template` and `kubeconform -strict` for Kubernetes 1.31, also with the agent service enabled          |
| CI    | `node scripts/helm-rehearsal.mjs` on kind: install, broken upgrade rolled back by `--atomic`, manual `helm rollback`, smoke tests |
