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
  Apify, Browse AI, Oxylabs, Bright Data, `direct`, `mock`) with fixture contract tests,
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

### C. Price-intelligence engine (2026-11-10)

**Built**

- `@suskii/shared` (`price-intel.ts`): products, policy statuses and bases, `basisIssue()`,
  vendors, proxy classes and their ladder, failure classes with one reaction each, the
  observation rules (`judgeObservation()`), price and currency reading from text, domain
  checks, the budget alert levels and the night window.
- Six tables in one expand-only migration (`price_sources`, `source_policies`, `scrape_jobs`,
  `scrape_attempts`, `price_observations`, `provider_budgets`) with database checks, each in the
  data registry with a retention rule (jobs and attempts 90 days, observations 400, kept pages
  7). None holds personal data.
- `apps/api/src/price-intel`: the site registry and its decisions, seven `ScrapeProvider`
  adapters (Firecrawl, Apify, Browse AI, Oxylabs, Bright Data, `direct`, `mock`), the router
  (failover, proxy ladder, health order, hard caps), breakers, the per-site throttle, budgets
  with alerts, kill switches, the SSRF guard, extraction (structured data, selector recipes,
  vendor fields), observations judged against history and other sites, parser drift, single
  flight, the scheduled sweep and the scraping register.
- Routes: `/v1/admin/data-sources` (list, overview, register, reads, create, change, approve,
  block, review, read, observations, switches, budgets) and
  `POST /v1/internal/price-intel/sweep`. A worker job calls the sweep every 30 minutes; a site
  is read only inside its own night.
- For the owner: `sandbox:scrapers` with `scrapers-sandbox.yml`, `price-intel:register`,
  `docs/legal/scraping-register.md`, section 7.1 of the launch checklist and
  `docs/runbooks/price-intelligence.md`.

**How to try it** (local stack; the mock vendor answers and nothing is fetched)

1. Sign in to the API as a super admin and create a site: `POST /v1/admin/data-sources` with a
   domain, a page address template, a recipe, `vendors: ["mock"]` and a time zone
   (`apps/api/test/price-intel.e2e-spec.ts` has a complete body).
2. Read it while it is in review: `POST /v1/admin/data-sources/{id}/read` with
   `{"product":"hotel","query":{"place":"Lagos","from":"2027-01-10","to":"2027-01-12"}}`.
   Three indicative hotel prices come back; the same question again answers `fresh` without
   another read.
3. Record what the robots file and the terms say (`PATCH`), approve with a basis
   (`POST .../approve`, which asks for step-up), then block it and read again: `denied`.
4. `GET /v1/admin/data-sources/overview`, `/jobs` and `/register` show the vendors, the
   budgets, each read with its tries, and the register.

**What changed from the plan**

- Contract fixtures were written from the vendors' published SDKs, not recorded: no vendor
  account exists and the vendors' documentation hosts are not reachable from the build
  environment. `sandbox:scrapers` is the live check, and it is the owner's to run.
- A site in review is answered by the mock vendor outside production, so a new site's
  addresses and recipe can be tried before anyone approves it. Production has no mock.
- A page is kept only when nothing could be read from it; a page that was read leaves a hash.
- Model-assisted reading of pages is not built: no page text reaches a model.
- The amendments are recorded at the end of ADR-102.

**Found by the gate and fixed**

- A change to one field of a site reset its other rules to their defaults (Zod applies a
  default inside an optional field) and sent an approved site back to review. Defaults now
  apply on creation only; a unit test and the end-to-end suite hold it.
- An answer read now and the same answer given again from observations came in different
  orders; both are cheapest first.
- Two contract tests that list every internal operation and every step-up operation needed
  the new routes; the worker's retention fixture needed the new rules.

**Test results** (commit `0c42ada`, local, 2026-11-10; the commits after it change
documents only)

| Check                                                      | Result                                |
| ---------------------------------------------------------- | ------------------------------------- |
| `pnpm lint`                                                | 14 of 14 workspaces                   |
| `pnpm typecheck`                                           | 13 of 13 workspaces                   |
| `pnpm test` (unit, every workspace)                        | 11 of 11 tasks                        |
| API unit (`test:cov`, with the 80% gates)                  | 71 suites, 788 tests                  |
| of which `src/price-intel`                                 | 6 suites, 68 tests                    |
| API e2e (full, `test:e2e:cov`)                             | 69 suites, 716 tests                  |
| of which `price-intel.e2e-spec.ts`                         | 21 tests                              |
| `@suskii/shared`                                           | 354 tests (20 for price intelligence) |
| `@suskii/worker`                                           | 52 tests                              |
| `pnpm check:migrations`, `pnpm security:checklist --check` | pass                                  |
| `pnpm format:check`, `pnpm test:scripts`                   | pass                                  |

Before this sub-phase: API unit 719, API e2e 680.

**Not run, and why**: no vendor was called. The five adapters have never met a live account;
`sandbox:scrapers` printed "No vendor had its keys set" here, as it should.

**Open for the owner** (`docs/owner/launch-checklist.md`, section 7.1): the vendor accounts,
keys and spending limits; one run of `scrapers-sandbox.yml` with a page of Suskii's own site;
counsel's and the owner's approval of each site with its basis; whether to turn price
intelligence on in production.

**Not done here**: nothing shows an indicative price to a traveller yet. The agent's price
tools come in D, assisted quotes in E, the console screens in F.

### D. Agent core (2026-11-10)

**Built**

- `@suskii/shared`: the wire between the API and the agent service (`agent-protocol.ts`: a run
  request, `status` events and one `end`, answers, cards with links inside the site only,
  notices as codes) and the rules of the guard (`agent-grounding.ts`: figures and contacts
  against sources, outcome claims against statuses, instructions read back, tools named,
  secrets asked for).
- `apps/agent` (Node ESM, LangGraph 1.7.2, Vitest): settings that refuse hosted tracing and,
  in production, a mock model, plaintext hops and missing tokens; a model interface with an
  Anthropic adapter and a mock; versioned prompts for the router and ten customer specialists;
  a rule-based pre-router; one graph (begin, route, think, act, confirm, check, finish) built
  per run; the tool gateway client; the run service with limits on time, model turns, tool
  calls and concurrent runs; a Postgres checkpointer that never calls `setup()`; an HTTP
  server with one route for the API and a health check.
- The `agent` schema with the checkpoint tables as a checked-in migration, the `suskii_agent`
  role (its schema only) and `suskii_app`'s right to delete a thread; threads deleted with the
  conversation and the account and purged 30 days after their last turn.
- API chat (`src/agent/chat`): conversations (owner's session or a guest's token after a human
  check), `POST /v1/agent/chat` (202), a run's events as a stream or by polling, feedback, the
  spend reservation and settlement at `AGENT_MODEL_PRICES`, a mock client for a stack without
  the service.
- Sixteen tools for the customer agents (`src/agent/tools`): `flights.search`, `hotels.search`,
  `cars.rentals`, `cars.buses`, `packages.search`, `tours.search`, `visa.requirements`,
  `addons.search`, `bookings.list`, `bookings.get`, `payments.options`, `trips.list`,
  `trips.get`, `trips.plan`, `support.faqs` and `support.handover`, beside `catalog.places`
  and `platform.status`. Fourteen read; two prepare something; none commits.
- Three evals (`apps/agent/src/evals`, fixtures in `apps/agent/evals`), the commands
  `eval:agent-routing`, `eval:agent-grounding` and `eval:agent-safety` (`--recorded`), and
  `agent-eval.yml` for the owner's run against the model.
- `apps/api/test/agent-service.e2e-spec.ts`: the chain with the agent service as its own
  process.
- For the owner: section 7.2 of the launch checklist.

**How to try it** (local stack; no model is called)

1. `pnpm dev` starts the API, the worker and the agent service (port 4200) from the root
   `.env`; `AGENT_ENABLED` is on outside production and `AGENT_MODEL_PROVIDER=mock`.
2. Sign in and open a conversation: `POST /v1/agent/conversations` (a guest sends
   `turnstileToken`).
3. `POST /v1/agent/chat` with `{"conversationId": "...", "text": "What is the status of the
website right now?"}` answers 202 with a `runId`. `GET /v1/agent/runs/{runId}` shows the
   events (`routing`, `thinking`, `tool` with `platform.status`, `checking`, the message,
   `done`); `GET /v1/agent/conversations/{id}` shows the sample assistant's answer. Any other
   message gets its one fixed sentence.
4. Without the agent service, set `AGENT_SERVICE=mock`: the API answers by itself.
5. `pnpm --filter @suskii/agent eval:agent-safety --recorded` prints each red-team case and
   what the model tried.

**What changed from the plan**

- The specialists are one graph that takes a specialist per turn (its prompt and its tools),
  not a subgraph each: ten subgraphs would differ only in a prompt and a tool list, and one
  graph has one guard that nothing can route around.
- Chat answers 202 and the stream is a GET; no words are streamed before the guard has passed
  them; what the assistant says without a model is a code the clients put into words (ADR-101,
  amendments).
- The confirmation routes and their table move to E, with the first commit tool. The graph's
  interrupt and resume are built and tested now.
- The tool for indicative prices moves to E, with assisted quotes: a price seen on another
  site has no path to a sale until then, and showing one without it would be a dead end.
- The disruption specialist has the bookings tools; live flight status and the airline-change
  tools come with it in E, as planned there.
- The `google` model provider is not built (ADR-106, amendments).

**Found by the gate and fixed**

- **A hole in the guard**: a model that repeated a refused answer had it sent on the second
  try, because the check counted the model's own draft, and the guard's note listing the
  invented figures, among its sources. Found by the grounding eval on its first run. A turn
  now keeps what the traveller wrote apart from what the model was shown.
- A false alarm in the outcome check: "the government fee is paid separately", quoted from a
  tool result, read as a payment. A rule in the present tense about how something is paid is
  no claim.
- A run whose answer could not be stored stayed "running" until the time limit; it is now
  closed as failed at once.
- The agent protocol imported Zod past the shared set-up module (a guard test of the shared
  package caught it).
- A test of mine deleted the seeded help articles in a shared test database and broke another
  suite; it now adds and removes only its own.
- The tier tripwire of the gateway suite ("everything shipped only reads") became "nothing
  shipped commits", with the two tools that prepare something named in the tools suite.

**Known limits, kept in view**

- The guard refuses arithmetic the tools did not do (one grounded case of the suite fails on
  purpose to show it), so tools return totals, counts and lengths ready to say.
- The check for instructions read back is word for word: a paraphrase or a translation
  passes. The instructions hold nothing secret.
- A figure the traveller wrote may be said back to them; an outcome may not be taken from
  their word.
- The evals ran with recorded answers only. How the real models route, how often the guard
  has to refuse them and what a run costs are unmeasured until the owner's run.

**Test results** (local, 2026-11-10: the API end-to-end suite, lint, types and the unit
tests on commit `e6f34b6`; the API unit, web, mobile and admin suites on `7937672`, which
differs only by one test file and a fixture; the commits after them change documents only)

| Check                                                      | Result                           |
| ---------------------------------------------------------- | -------------------------------- |
| `pnpm lint`                                                | 15 of 15 workspaces              |
| `pnpm typecheck`                                           | 14 of 14 workspaces              |
| `pnpm test` (unit, every workspace)                        | 12 of 12 tasks                   |
| API unit (`test:cov`, with the 80% gates)                  | 74 suites, 808 tests             |
| API e2e (full, `test:e2e:cov`)                             | 73 suites, 755 tests             |
| of which the five agent suites                             | 50 tests                         |
| `@suskii/agent`                                            | 54 tests (10 in the three evals) |
| `@suskii/shared`                                           | 373 tests                        |
| `@suskii/worker`                                           | 52 tests                         |
| Web e2e (Chromium and slow 3G)                             | 242 tests                        |
| Mobile (Jest)                                              | 50 suites, 319 tests             |
| Admin e2e                                                  | 24 tests                         |
| `pnpm check:migrations`, `pnpm security:checklist --check` | pass                             |
| `pnpm format:check`, `pnpm test:scripts`                   | pass                             |

| Eval (recorded answers) | Result                                              | Pass mark          |
| ----------------------- | --------------------------------------------------- | ------------------ |
| `eval:agent-routing`    | 78 of 81 (96.3%); 16 by rule without a model call   | 95%                |
| `eval:agent-grounding`  | no invention shown; 15 of 16 grounded answers shown | 0 shown, 90% shown |
| `eval:agent-safety`     | 28 of 28 held; no violation                         | 0 violations       |

Before this sub-phase: API unit 788, API e2e 716. The first full API e2e run failed in two
suites: the cross-account matrix, which rightly asked for the five new chat routes (added), and
the object storage suite, whose throwaway gateway needs the container runtime that had stopped
on this machine (restarted; no code changed).

**Not run, and why**: no model was called; `LLM_API_KEY` is the owner's. The Anthropic adapter
is covered by unit tests that answer its HTTP calls; `agent-eval.yml` is the live check.

**Open for the owner** (`docs/owner/launch-checklist.md`, section 7.2): the model key and the
provider's data retention terms; one run of `agent-eval.yml`; the models and their prices; the
spend caps; the help articles; who answers a handover; whether guests may use the assistant.

**Mobile contract**: `topic` in support conversation answers gains `assistant_handover`. A
build without the new catalog string shows the key on that conversation's badge. No other
answer changes; the chat routes are new.

**Not done here**: no client offers the assistant (G), the console has no screen for it (F),
nothing commits (E), and the agent service has no image, Terraform or Helm yet (H).
