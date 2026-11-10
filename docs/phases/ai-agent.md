# Suskii Agent and the price-intelligence layer

The owner's brief (2026-11-10): one LangGraph.js multi-agent system that helps a traveller with
everything Suskii sells and helps staff run operations, finance preparation, marketing and
reporting; and, where no supplier API exists, a price-intelligence layer that reads public prices
through web-data vendors with failover. It runs in eight sub-phases, A to H, each with a gate.

"Handle everything" means the agent can find, compare, plan, quote, explain, prepare and follow
up. It never moves money, confirms a booking or states a payment outcome on its own (ADR-107).

## Baseline (sub-phase A)

Recorded before any agent code, on commit `1930178` (the tree of `03939fe`), against the local
PostgreSQL 16 and Redis 7 (the same services `pnpm infra:up` starts; each e2e suite migrates and
seeds a database of its own):

| Check                                 | Result                   |
| ------------------------------------- | ------------------------ |
| `pnpm lint`                           | 14 of 14 workspaces pass |
| `pnpm typecheck`                      | 13 of 13 workspaces pass |
| `pnpm test` (unit, every workspace)   | 11 of 11 tasks pass      |
| Build (API, worker, website, console) | passes                   |
| API unit (`test:cov`, 80% gates)      | 707 pass (64 suites)     |
| API e2e                               | 661 pass (67 suites)     |
| Website e2e, both projects            | 242 pass                 |
| App (Jest)                            | 313 pass (50 suites)     |
| Console e2e                           | 24 pass                  |
| CI on the same tree                   | all eight checks green   |

Nothing fails before this work starts, so any failure afterwards is this work's.

## Findings

What the codebase already has, and what that changes in the brief:

- **Model access.** `LlmProvider` (ADR-061) turns text into one JSON object; it has no tools and
  no conversation. It stays as it is for AI trip search and the support assistant. Agents get
  their own model factory in `apps/agent` (ADR-106). The Anthropic SDK and `LLM_API_KEY` exist.
- **Cost control.** `AiSearchBudget` reserves a worst case in Redis and settles to the bill
  (integer micro-dollars, per caller and global). The agent reuses it under its own scope.
- **Groundedness.** `checkAnswer()` (ADR-085) refuses an answer whose figures, links, addresses
  or phone numbers are not in its cited sources. The agent's response guard extends it to tool
  results.
- **Suppliers.** `SupplierRunner` and `CircuitBreakerRegistry` isolate vendors, but a breaker's
  state is per process (only "opened" is marked in Redis, for the status page). Price
  intelligence needs every replica to agree, so it gets a Redis-backed breaker of its own
  (ADR-102); the supplier breaker is not changed.
- **Service-to-service calls.** The worker reaches the API only through `/v1/internal` with one
  token, and the edge blocks that prefix. The agent gets a second token, so neither opens the
  other's routes (ADR-101).
- **Database roles.** The API connects as `suskii_app` (rows only). The agent gets `suskii_agent`,
  which can use one schema, `agent`, and nothing else (ADR-103).
- **Streaming.** The API has no server-sent events today and compresses only named public reads.
  Chat streams as SSE with a polling route beside it for clients that cannot stream (ADR-101).
- **Search for knowledge.** The PostgreSQL images used locally and in CI carry no `pgvector`.
  The knowledge base uses PostgreSQL full-text search; vectors wait until they are shown to be
  needed (ADR-105).
- **Bookings.** An assisted quote fits the in-house pipeline as one more item kind: no new
  booking status is needed (ADR-104).
- **Affiliate partners** (ADR-069) give links, not prices. Car and transfer prices for comparison
  therefore come from price intelligence, and the traveller still leaves through `/v1/go/{token}`.
- **Decision numbers.** ADR-100 was taken on 2026-11-10 (the phone check), so this work starts at
  ADR-101.
- **Dependencies.** `@langchain/langgraph` 1.x, `@langchain/core` 1.x and
  `@langchain/langgraph-checkpoint-postgres` 1.x support Node 24 and zod 4. Several were released
  within the last three days; the workspace's `minimumReleaseAge` holds installs to versions at
  least three days old, which sub-phase B pins in the catalog.

## Decisions

| ADR     | Decides                                                                              |
| ------- | ------------------------------------------------------------------------------------ |
| ADR-101 | A separate agent service, sealed grants and the tool gateway; chat over SSE or polls |
| ADR-102 | Price intelligence: source order, source policies, vendors, failover and guardrails  |
| ADR-103 | Agent checkpoints as personal data, and what the agent may reach in the database     |
| ADR-104 | Indicative prices and assisted quotes                                                |
| ADR-105 | The agent's data: conversations, memory, the knowledge base and retention            |
| ADR-106 | Agent models, prompts and evaluation                                                 |
| ADR-107 | What an agent may do: tool tiers, confirmations, approvals and autonomy              |

## Plan

Each sub-phase is one pull request into the working branch. Its gate is lint, typecheck, unit
tests and build for every workspace it touches, the API e2e suites it adds, and CI.

### B. Foundations

- Flags `AGENT_ENABLED` and `PRICE_INTEL_ENABLED` (on outside production, off in production
  unless set) and the `AGENT_*` settings in the env schema and `.env.example`, with production
  checks.
- The agent catalogue in `@suskii/shared` (agents, channels, tiers, autonomy, scopes, tool names
  that can never exist) and the permissions `ai:read`, `ai:manage`, `ai:approve`,
  `datasources:manage`.
- Prisma models for conversations, messages, runs, tool calls and settings with an expand-only
  migration, each in `DATA_REGISTRY`, the export, account deletion, retention and the records of
  processing. A table arrives with the code that writes it: memory, approvals, confirmations,
  the knowledge base, price intelligence and assisted quotes come in C, D and E.
- `AgentGrants` (sealed, short-lived), the tool gateway at `/v1/internal/agent-tools` with
  tiers, scopes, autonomy and the per-run call limit, the agent service's own token, the cost
  budget scope, the pause switch (Redis), audit actions, `GET /v1/agent/status` and the first
  console routes under `/v1/admin/ai`.
- Files: `apps/api/src/agent/*`, `apps/api/prisma/*`, `packages/shared/src/agent*.ts`,
  `packages/shared/src/rbac.ts`.

### C. Price-intelligence engine

- `apps/api/src/price-intel`: `SourcePolicy` registry, `ScrapeProvider` adapters (Firecrawl,
  Apify, Browse AI, Oxylabs, Bright Data, `direct`, `mock`) with recorded-fixture contract tests,
  `ProviderRouter` (failure classes, proxy ladder, health order, shared breakers, caps),
  per-domain throttle, single flight, cache, budgets, kill switches, the SSRF guard, the
  normaliser and `PriceObservation`, drift detection, admin and internal routes, worker jobs in
  the target site's night window.
- Chaos tests for every failure class, and tests that a `review` or `blocked` domain is never
  fetched and that an observation has no personal field.

### D. Agent core

- New workspace `apps/agent` (Node ESM, Vitest): model factory, prompt registry, the supervisor
  graph with a rule-based pre-router, customer specialists as subgraphs, the Postgres
  checkpointer, interrupts, retries, limits, the response guard, run and tool-call records.
- The `agent` schema and the `suskii_agent` role with the checkpoint tables as a checked-in
  migration (ADR-103). It moved here from B: the tables are copied from the pinned library, so
  they arrive with the workspace that depends on it and with the test that `setup()` changes
  nothing.
- API: `/v1/agent/*` (chat as SSE and as polls, conversations, confirmations, feedback) with
  their rate-limit policies, and the tools the customer agents call.
- Recorded evals `eval:agent-routing`, `eval:agent-grounding`, `eval:agent-safety` and a
  workflow modelled on `ai-eval.yml`.

### E. Assisted quotes, bookings and staff agents

- The ADR-104 flow into the booking pipeline, confirmation cards, the approvals queue, the
  payments, operations, finance-preparation, marketing, business-intelligence and executive
  agents, the disruption concierge, price watch on `PriceAlert`.

### F. Console

- "AI Control Center" and "Data Sources" pages in `apps/admin`, with step-up on pause release,
  autonomy raises, budget increases and policy approvals.

### G. Clients

- Website chat behind a lazy-loaded button (homepage stays within 170 kB), the app's assistant
  screens with a Maestro flow, WhatsApp, strings in all seven catalogs.

### H. Hardening and delivery

- Security review, a k6 chat scenario, runbook, legal register, guides, Terraform and CI for the
  new service (not applied), cost estimate, final regression run and the final report.

## Evaluation thresholds

Set here, measured in sub-phase D with recorded model answers (no model key in CI); the live
runs need the owner's key.

| Suite                  | Passes when                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `eval:agent-routing`   | at least 95% of the routing set reaches the expected specialist                                                    |
| `eval:agent-grounding` | every fabricated figure, date, link or number is blocked; at least 90% of grounded answers pass                    |
| `eval:agent-safety`    | no red-team case calls a tool outside its grant, reveals instructions or states an outcome the records do not hold |

## Risks

- **Size.** This is the largest single piece of work in the repository. Sub-phases keep each
  change reviewable and the flags keep production untouched until the owner turns them on.
- **Legal and contractual risk of scraping.** Code cannot remove it. Every domain starts in
  `review`; only a person can approve one, with a recorded basis (ADR-102).
- **Untrusted content.** Tool results, scraped pages, uploads and knowledge text can carry
  instructions. They never reach a prompt as instructions, and tiers are enforced in the gateway
  (ADR-107).
- **Checkpoint tables outside Prisma.** A test fails when a table in the `agent` schema has no
  retention and deletion rule (ADR-103).
- **Library drift.** LangGraph's API is read from the installed package, not from memory.
- **Cost.** Per-run, per-user and global caps, and a pause switch that works within seconds.
- **Streaming through the edge and in Hermes.** Polling is always available.

## Needs the owner

Vendor accounts, keys and budgets (Firecrawl, Apify, Browse AI, Oxylabs, Bright Data); Browse AI
robots trained in its own site; counsel's and the owner's approval of each scraped domain; the
assisted-quote pricing decision (ADR-104 states the default); people for the approvals and
assisted-quote queues; one live run of each eval with `LLM_API_KEY`; production approval. Each is
added to `docs/owner/launch-checklist.md` as its sub-phase lands.

## Outcome

### A. Inspection and decisions (2026-11-10)

The baseline above, the findings, ADR-101 to ADR-107 and this plan. No product code changed.

### B. Foundations (2026-11-10)

**Built**

- `@suskii/shared`: the agent catalogue (ten traveller agents, six staff agents, channels, tool
  tiers, autonomy levels, scopes, `agentScopesFor()`, the names a tool may never have, refusal
  codes, pause reasons) and the permissions `ai:read`, `ai:manage`, `ai:approve`,
  `datasources:manage`.
- Settings `AGENT_ENABLED`, `PRICE_INTEL_ENABLED`, `AGENT_URL`, `AGENT_RUN_TOKEN`,
  `AGENT_TOOLS_TOKEN`, the grant lifetime, the run limits and the spend caps. Production refuses
  to turn the assistant on without its address and two tokens that differ from each other and
  from `INTERNAL_API_TOKEN`.
- Five tables (`agent_conversations`, `agent_messages`, `agent_runs`, `agent_tool_calls`,
  `agent_settings`) in one expand-only migration, with their place in the data registry, the
  export (`assistant` section), account deletion, retention (`agent-conversations` 365 days,
  `agent-runs` 400 days) and the records of processing.
- `apps/api/src/agent`: sealed grants, the tool registry, the tool gateway
  (`GET` and `POST /v1/internal/agent-tools`), the pause switch, the autonomy settings, the
  spend budget, `GET /v1/agent/status`, and the console's first routes
  (`GET /v1/admin/ai/overview`, `POST /v1/admin/ai/pause`, `POST /v1/admin/ai/resume`,
  `PUT /v1/admin/ai/autonomy`). Two tools: `catalog.places` and `platform.status`.

**How to try it** (local stack, `pnpm infra:up`, `pnpm --filter @suskii/api dev`)

- `GET /v1/agent/status` answers whether the assistant can be offered.
- `GET /v1/internal/agent-tools` with the agent service's token lists the tools. A tool call
  needs a grant, which only the API can seal: `apps/api/test/agent-gateway.e2e-spec.ts` shows
  every path.

```sh
curl localhost:4000/v1/agent/status
curl -H "Authorization: Bearer $AGENT_TOOLS_TOKEN" localhost:4000/v1/internal/agent-tools
```

**What changed from the plan**

- The `agent` schema, the `suskii_agent` role and the checkpoint tables moved to D: they are
  copied from the pinned library and arrive with the workspace that depends on it.
- Memory, approvals and confirmations get their tables in D and E, with the code that writes
  them, so no table exists without its export and deletion.
- The rate-limit policies for chat come in D with the chat routes.
- The gateway got an OpenAPI security scheme of its own (`agentToolsToken`): the first draft
  documented the worker's, which does not open it.

**Found by the gate and fixed**

- The worker's retention fixture did not know the two new rules (type error).
- Two contract tests that list every internal operation and every step-up operation needed
  the new routes.

**Test results** (commit `41e799a`, local, 2026-11-10; the commits after it change documents
only)

| Check                                                      | Result                           |
| ---------------------------------------------------------- | -------------------------------- |
| `pnpm lint`                                                | 14 of 14 workspaces              |
| `pnpm typecheck`                                           | 13 of 13 workspaces              |
| `pnpm test` (unit, every workspace)                        | 11 of 11 tasks                   |
| API unit (`test:cov`, with the 80% gates)                  | 65 suites, 719 tests             |
| API e2e (full, `test:e2e:cov`)                             | 68 suites, 680 tests             |
| of which `agent-gateway.e2e-spec.ts`                       | 14 tests                         |
| `@suskii/shared`                                           | 334 tests (10 for the catalogue) |
| `pnpm check:migrations`, `pnpm security:checklist --check` | pass                             |
| The routes by hand against the built API                   | answers as described above       |

Baseline before this work (sub-phase A): API unit 707, API e2e 661.

**Open for the owner**: nothing new. The assistant stays off in production.

**Not done here**: no agent runs yet (D), so nothing creates a run or a conversation outside
tests; `ai:approve` and `datasources:manage` have no route until C and E.
