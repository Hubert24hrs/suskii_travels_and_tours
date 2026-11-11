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
- Read against section 10 of the brief when F started, the console also owes: live runs and
  their history with the tool-call trace; a conversation monitor (masked, permissioned,
  audited); cost by agent, model, channel and account, with a month-end forecast; quality
  (thumbs, answers the guard refused, handover rate, prompt versions); switching one agent off;
  the limits in force; the knowledge base (ADR-105: upload, scan, full-text search, a tool that
  cites what it used); and, for data sources, each vendor's success and refusal rate, latency,
  cost per price read and breaker state. Each needs its admin route first.

### G. Clients

- Website chat behind a lazy-loaded button (homepage stays within 170 kB), the app's assistant
  screens with a Maestro flow, WhatsApp, strings in all seven catalogs.
- What a traveller sees of E: confirmation cards, assisted quotes (request, offer, the page
  the messages link to), indicative prices with their source and time.
- From section 12 of the brief, with the client that shows each: consented memory of
  preferences (ADR-105: a table, the traveller's own page to see, change and erase it, a tool
  that reads it and one that asks to remember); a fare trend from the fare history, labelled
  as a trend; a shareable PDF of a plan or a quote with its validity, sources and the "to be
  confirmed" wording; company travel policy in the trip builder's answers; a handover that says
  when an answer is expected; a satisfaction question after a conversation.
- **Built (2026-11-11)**: the outcome is under "G. Clients" below. Moved to H: shadow mode
  and prompt versions compared before they answer, a recipe proposal for a site in drift, the
  eval results in the console and the forecast alert. Not built: a remembered meal
  preference (ADR-105, amendments).

### H. Hardening and delivery

- Security review, a k6 chat scenario, runbook, legal register, guides, Terraform and CI for the
  new service (not applied), cost estimate, final regression run and the final report.
- Staff cases in the routing and safety evals (the staff agents arrived in E with unit and
  end-to-end tests but no eval of their own), and cases for G's tools: a fare trend is never
  worded as a forecast, a meal or a health need is never offered to be remembered, and a
  passport reminder is never a decision about entry.
- Shadow mode (section 12 of the brief): a prompt version that runs beside the live one, is
  never shown, and is compared before it may answer.
- Left by F, from sections 10 and 12 of the brief: a recipe proposal when a site's pages stop
  yielding prices, decided in Approvals; the results of the evals in the console (they are in
  CI today); an alert when the month's forecast passes a threshold.

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

### E. Confirmations, assisted quotes and staff agents (2026-11-11)

**Built**

- **Confirmations** (ADR-107). `agent_confirmations`, `AgentConfirmationsService` and three
  routes (`GET /v1/agent/confirmations/{id}`, `POST .../confirm`, `POST .../decline`). A
  `commit` tool has a `prepare()` beside its `run()`; the gateway calls `prepare()`, stores
  the card and answers the model `confirmation_required` with its id. The traveller's tap
  (their session, an `Idempotency-Key`) claims the row, runs the tool with a grant built from
  that session and resumes the assistant with what the records then hold. One card per
  conversation, 15 minutes, ended by a new message; refused while paused.
- **Five commit tools**: `bookings.cancel`, `changes.accept`, `changes.take_refund_offer`,
  `alerts.watch`, `alerts.stop`. **Three reads** beside them: `flights.status`, `changes.get`,
  `alerts.list`.
- **Assisted quotes** (ADR-104). `@suskii/shared` rules (`assisted-quotes.ts`), the
  `assisted_quotes` table, `AssistedQuotesService`, the traveller's routes
  (`POST /v1/quotes/assisted`, `GET /v1/quotes/assisted/{id}`, `.../withdraw`,
  `GET /v1/me/assisted-quotes`) and staff's (`/v1/admin/assisted-quotes`: the queues, `offer`,
  `close`, `booked`, `unbookable`). On the booking pipeline as vertical and item kind
  `assisted`: priced from the verified supplier price with the vertical's fee rules, booked
  and paid through the ordinary checkout, then held in `TICKETING` until staff record the
  supplier's confirmation (`CONFIRMED`) or that it cannot be booked (`REFUND_PENDING`, all
  refunded). Messages to the traveller when a quote is answered. Settings
  `ASSISTED_QUOTES_ENABLED`, `ASSISTED_QUOTE_VALID_MINUTES`, `ASSISTED_QUOTE_REQUEST_HOURS`.
- **Indicative prices for the assistant**: `prices.indicative` (approved sites only, each
  price marked indicative with where and when it was seen), `quotes.request` and
  `quotes.list`.
- **Staff agents** (ADR-107). Console chat (`/v1/admin/ai/conversations`, `/v1/admin/ai/chat`,
  `/v1/admin/ai/runs/{id}`) for staff with `ai:read`, to the agents their own permissions
  open; eight staff tools (`ops.queues`, `reports.sales`, `finance.overview`,
  `finance.booking_payments`, `finance.draft_refund_request`, `marketing.promos`,
  `marketing.draft_promo`, `sources.overview`); in the agent service a staff router, a role
  for each of the six agents and the rules they work under.
- **The approvals queue**: `agent_approvals`, `AgentApprovalsService`,
  `/v1/admin/ai/approvals` (list with the assisted-quote counts, one, `approve`, `reject`). Two
  kinds: a refund request and a promo code.
- Version 2 of the customer specialists' prompts; the tools snapshot of the evals (37 tools);
  counters for confirmations, proposals and assisted quotes; each new table in the data
  registry, the export where it is a traveller's, account deletion, retention and the records
  of processing.
- Documents: amendments to ADR-104 and ADR-107, the runbook
  `docs/runbooks/assisted-quotes.md`, section 7.3 of the launch checklist, the access control,
  data classification and business limits pages.

**How to try it** (local stack; no model and no supplier is called)

1. `pnpm infra:up`, `pnpm --filter @suskii/api db:deploy`, `db:seed`, then `pnpm dev`. Set
   `AGENT_SERVICE=mock` to have the API answer without the agent service.
2. **An assisted quote.** Signed in as a traveller: `POST /v1/quotes/assisted` with an
   `Idempotency-Key` and `{"product":"hotel","title":"A room by the lagoon","request":
{"destination":"Lagos","startDate":"2027-01-10","endDate":"2027-01-12","adults":2},
"currency":"NGN"}`. As staff (`pnpm --filter @suskii/api staff:bootstrap` makes the first
   super admin): `GET /v1/admin/assisted-quotes?queue=to_verify`, then `POST
/v1/admin/assisted-quotes/{id}/offer` with the supplier's name, price, the address of the
   proof and the details. The traveller's `GET /v1/quotes/assisted/{id}` now carries an offer
   with a `quoteId`: book it with `POST /v1/bookings` and pay on the mock provider's page. The
   booking stays in `TICKETING` until staff `POST .../booked` with the supplier's reference.
3. **A confirmation.** `apps/api/test/agent-confirmations.e2e-spec.ts` is the shortest way to
   see one: a script plays the agent, calls `bookings.cancel` through the gateway and gets
   only a confirmation id; the traveller's tap cancels.
4. **A staff agent and an approval.** As staff: `POST /v1/admin/ai/conversations` with
   `{"locale":"en-NG"}`, then `POST /v1/admin/ai/chat`. With the agent service running on the
   mock model, "How many refunds are waiting?" is routed to finance preparation.
   `apps/api/test/agent-staff.e2e-spec.ts` shows a draft refund request reaching
   `GET /v1/admin/ai/approvals` and being approved by another person.

**What changed from the plan**

- **Assisted quotes have a queue of their own**, counted in the approvals list
  (`alsoWaiting`): verifying a price and booking by hand have their own forms.
- **Indicative prices are shown by the assistant only.** Search never imports price
  intelligence, so no result list carries a `web-intel` row (ADR-104, amendments).
- **Creating a booking and starting a payment are not tools.** The assistant links to the
  ordinary checkout; the five commit tools act on a booking that already exists.
- **A price that moved after payment is refunded, not charged**: no consent step asks a
  traveller for more after they paid.
- **Two kinds of proposal** exist. Campaign spend and drift recipes have no agent preparing
  them; source approvals stay on the data sources page with step-up.
- **No console page yet**: the queues are worked through the admin API until F.

**Found while building, and fixed**

- **The switch could strand a paid booking.** `ASSISTED_QUOTES_ENABLED=false` answered 404 on
  every route, staff's included, so a booking already paid could be neither booked nor
  refunded. Found while writing the runbook. Off now stops only what is new; a test books by
  hand on an instance where the feature is off.
- **A proposal asked twice became two rows**: the stored payload came back from `jsonb` with
  its keys in another order, so the comparison failed. Found by the staff suite; payloads are
  now compared in a canonical form.
- **Rejecting needed only `ai:approve`.** A person who could not approve a kind could still
  reject it. Both decisions now need the kind's own permission.
- **Starting a staff conversation with an empty body created a row**, which the admin route
  matrix refuses for any mutation. The console now states its language.
- `GET /v1/quotes/assisted` was read as the quote with the id "assisted"; the list moved to
  `GET /v1/me/assisted-quotes`.
- One commit of mine (`3c1122a`) went in while a suite was still failing: the agent service
  test expected the first prompt version after the bump to the second. Fixed in the next
  commit (`69f8d34`); nothing was pushed to the base in between.
- **A flaky test from the hotel content work** (ADR-096) failed in the first web run of this
  gate: the demo hotels of a city are drawn from the city's id, which is new in every
  database, and this run's Lagos had no resort for the test to filter by. The test now takes
  whichever property type the search lists; it passed on two more fresh databases and in the
  full web run.

**Known limits, kept in view**

- **The staff agents have no eval of their own.** The three evals cover the customer agents;
  staff routing and the staff rules are covered by unit tests of the graph and by the API
  suite with a scripted agent. Staff cases join the routing and safety evals in H, before the
  owner's run against the model.
- **Nothing sweeps the queues.** A request, an offer and a proposal lapse when they are next
  read; a traveller is not told at the moment a request runs out of time.
- **An approval is claimed before it is carried out.** If the process stopped between the two
  steps, the row would read `approved` with no result. The list shows the missing result; no
  alert does.
- The message that tells a traveller their quote is answered links to a page the clients of
  G build.
- A staff tool answers with totals for at most a year and with at most 30 promo codes.

**Test results** (local, 2026-11-11: every suite on commit `831f6d6`, the last one that
changes code, except the web suite, which ran again in full on `faba55e` after the test fix
above; the commits after change documents only)

| Check                                                  | Result                           |
| ------------------------------------------------------ | -------------------------------- |
| `pnpm lint`                                            | 15 of 15 workspaces              |
| `pnpm typecheck`                                       | 14 of 14 workspaces              |
| `pnpm test` (unit, every workspace)                    | 12 of 12 tasks                   |
| API unit (`test:cov`, with the 80% gates)              | 74 suites, 808 tests             |
| API e2e (full, `test:e2e:cov`)                         | 76 suites, 806 tests             |
| of which the seven agent suites                        | 76 tests                         |
| of which assisted quotes                               | 9 tests                          |
| `@suskii/agent`                                        | 58 tests (10 in the three evals) |
| `@suskii/shared`                                       | 378 tests                        |
| `@suskii/worker`                                       | 52 tests                         |
| Web e2e (Chromium and slow 3G)                         | 242 tests                        |
| Mobile (Jest)                                          | 50 suites, 319 tests             |
| Admin e2e                                              | 24 tests                         |
| `pnpm check:migrations` (45 migrations)                | pass                             |
| `pnpm security:checklist --check`, `pnpm format:check` | pass                             |
| `pnpm test:scripts`                                    | 13 tests                         |

| Eval (recorded answers) | Result                                              | Pass mark          |
| ----------------------- | --------------------------------------------------- | ------------------ |
| `eval:agent-routing`    | 78 of 81 (96.3%); 16 by rule without a model call   | 95%                |
| `eval:agent-grounding`  | no invention shown; 15 of 16 grounded answers shown | 0 shown, 90% shown |
| `eval:agent-safety`     | 28 of 28 held; no violation                         | 0 violations       |

Before this sub-phase: API e2e 73 suites and 755 tests, `@suskii/agent` 54 tests,
`@suskii/shared` 373 tests. The first web run of the gate had one failure (240 of 242, one not
run), the flaky test described above.

**Not run, and why**: no model was called (`LLM_API_KEY` is the owner's), so how a real model
routes a staff question, uses the staff tools and words a proposal is unmeasured; no supplier
was called, because an assisted booking is made by a person.

**Open for the owner** (`docs/owner/launch-checklist.md`, section 7.3): who verifies assisted
quotes and books them by hand, and during which hours; the fee an assisted quote earns (none
today); where proof of a supplier's price and confirmation is kept; who decides what the staff
assistants prepare; whether to switch assisted quotes and the staff assistants on in
production.

**Mobile contract**: `vertical` in quote and booking answers gains `assisted`, and both gain
an optional `assisted` section. Such bookings exist only once assisted quotes are offered to
travellers. A build from before the clients of G lists an assisted booking under its reference
without a product label and ignores the push path `/account/quotes` (the notification still
arrives). No other answer changes; the confirmation, quote and console routes are new.

**Not done here**: the console has no page for any of this (F), no client offers the
assistant, a confirmation card or a quote (G), and the agent service has no image, Terraform
or Helm yet (H).

### F. Console (2026-11-11)

**Built**

- **Pages for what E built**: the assistant's switches (`/ai`), the staff chat
  (`/assistant`), approvals (`/approvals`), assisted quotes (`/assisted-quotes`) and data
  sources (`/data-sources`). Each shows for `ai:read`; an action is shown only to staff who
  hold its permission and is checked again by the API. Pause is one press with a reason;
  releasing it, changing a level, approving a site, switching reading back on and raising a
  budget ask for an authenticator code through the console's own step-up prompt.
- **What staff see of the assistant's work.** `AgentInsightsService` and
  `/v1/admin/ai/monitor/runs`, `.../runs/{id}`, `.../conversations`, `.../conversations/{id}`,
  `/cost`, `/quality` and `/limits`, drawn by two pages: **Assistant activity** (runs with a
  filter by status, agent and audience, refreshed every 15 seconds; a run's trace of tool
  calls; travellers' conversations) and **Assistant cost and quality** (estimated spend by
  agent, model, channel, day and account, the month so far and its forecast, the caps; runs
  answered, handed over, refused by the guard and failed, feedback, the same by prompt
  version; the limits in force and the model prices).
- **One agent's switch**: `PUT /v1/admin/ai/agents/{agent}`, on the assistant page.
- **The knowledge base** (ADR-105): tables `knowledge_documents` and `knowledge_chunks`
  (migration `20261122120000_knowledge_base`), `KnowledgeService`, eight routes under
  `/v1/admin/ai/knowledge`, the tool `knowledge.search` for every agent, the splitter and the
  limits in `@suskii/shared`, the card kind `source`, and the **Knowledge base** page (add a
  file, read its passages, download it, change its title or audience, archive and restore
  it, try a question).
- **Data source health**: `GET /v1/admin/data-sources/health` and its section on the data
  sources page.
- **The audit log narrowed to the assistant** (`area=assistant`), linked from the assistant
  page for staff who may read the log.
- The tools snapshot of the evals (38 tools), both new tables in the data registry and the
  records of processing, the knowledge and switch actions in the audit list, three menu
  entries, the console's copy.
- Documents: amendments to ADR-102, ADR-105 and ADR-107, section 7.4 of the launch
  checklist, the access control, data classification and business limits pages, the price
  intelligence runbook.

**How to try it** (local stack; no model and no vendor is called)

1. `pnpm infra:up`, `pnpm --filter @suskii/api db:deploy`, `db:seed`, then `pnpm dev` with
   `AGENT_SERVICE=mock`. `pnpm --filter @suskii/api staff:bootstrap` makes the first super
   admin; sign in to the console on port 3001.
2. **Knowledge base.** Add a Markdown file with a few headings for "Travellers", open
   "Passages", then "Try a question" with a question the file answers. Change it to "Staff
   only" and search again as a traveller: nothing is found.
3. **Activity.** Ask something on "Ask the assistant", then open "Assistant activity": the
   run is listed with its agent and outcome; "Trace" shows the tools it called. A traveller's
   conversation (start one with `POST /v1/agent/conversations` and `POST /v1/agent/chat`)
   opens with any address or number in it removed, and the audit log (Assistant, "The
   assistant's audit log") shows the reading.
4. **Cost.** Set `AGENT_MODEL_PRICES` (see `.env.example`) to see figures other than zero on
   "Assistant cost and quality".
5. **One agent.** On "Assistant", switch "Hotels" off: a question about hotels is then
   answered by the general agent.

**What changed from the plan**

- **Plain text and Markdown only** in the knowledge base, a search vector written with the
  row, any word of a question matching, a language instead of a locale, and no signed links
  (ADR-105, amendments).
- **The limits are shown, not edited.** The brief asks for "agent, model and limit
  configuration"; what can be changed in the console is each agent's level and switch and
  each tool's level. Run limits, caps and model prices are settings of the environment.
- **Not built here, moved to H**: a recipe proposal for a site in drift, the results of the
  evals in the console, and an alert on the month's forecast.

**Found while building, and fixed**

- **A conversation read could miss its own answer.** The messages were read before the run,
  so a read that fell between the answer being stored and the run ending said that nothing
  was running and showed no answer; the staff chat then stopped polling. Found by the
  console's chat journey; the run is read first.
- **The search preview stayed as it was after a document changed**: the page refreshed the
  list only, and asking the same question again answered from what was already shown. Found
  by the console's knowledge journey; a change now refreshes everything read from the
  knowledge base, and the same question asked again is searched again.
- The audit log is never emptied between tests, so a test that counted knowledge entries saw
  another test's; it now reads its own document's entries.
- **The gate caught a list I had not updated.** A test names exactly which admin operations
  need a fresh authenticator code; the single-agent switch carries the check and was not in
  the list, so the first full run of the API suite failed there (839 of 840). The list, this
  guide and the access control page now name it, and the suite ran again in full.

**Known limits, kept in view**

- **Nothing checks a knowledge document for personal data.** The form says none belongs in
  one; the people with `ai:manage` are trusted to keep it so.
- **Nothing is read from a PDF or an office file.**
- **Cost is an estimate** from reported tokens at configured prices; with no price set for a
  model, its runs cost nothing on the page. No invoice is read.
- **Everyone with `ai:read` can open a traveller's conversation**, masked and audited. The
  owner decides whether that should be fewer people.
- **The console shows no eval result**; the evals run in CI (`agent-eval.yml`) and locally.
- The cost and quality queries aggregate `agent_runs` at read time; they are bounded to 90
  days and are not cached.

**Test results** (local, 2026-11-11). The long suites ran on commit `f8f5025`, the last one
that changes what the API and the website do. The API suite had one failure there (the
step-up list above); after the fix the full API suite, the console suite and every
workspace's unit tests ran again on `4effea1`, the head of the branch. The commits between
the two change a console page (the runs list refreshing itself), formatting and documents.

| Check                                                  | Result                           | On        |
| ------------------------------------------------------ | -------------------------------- | --------- |
| `pnpm lint`                                            | 15 of 15 workspaces              | `f8f5025` |
| `pnpm typecheck`                                       | 14 of 14 workspaces              | `f8f5025` |
| `pnpm test` (unit, every workspace)                    | 12 of 12 tasks                   | `4effea1` |
| API unit (`test:cov`, with the 80% gates)              | 74 suites, 808 tests             | `f8f5025` |
| API e2e (full, `test:e2e:cov`)                         | 78 suites, 840 tests             | `4effea1` |
| of which the knowledge base and the insights           | 15 tests                         | `4effea1` |
| `@suskii/agent`                                        | 58 tests (10 in the three evals) | `4effea1` |
| `@suskii/shared`                                       | 385 tests                        | `4effea1` |
| Web e2e (Chromium and slow 3G)                         | 242 tests                        | `f8f5025` |
| Mobile (Jest)                                          | 50 suites, 319 tests             | `f8f5025` |
| Admin e2e                                              | 31 tests                         | `4effea1` |
| `pnpm check:migrations` (46 migrations)                | pass                             | `4effea1` |
| `pnpm security:checklist --check`, `pnpm format:check` | pass                             | `4effea1` |
| `pnpm test:scripts`                                    | 13 tests                         | `4effea1` |

| Eval (recorded answers) | Result                                              | Pass mark          |
| ----------------------- | --------------------------------------------------- | ------------------ |
| `eval:agent-routing`    | 78 of 81 (96.3%); 16 by rule without a model call   | 95%                |
| `eval:agent-grounding`  | no invention shown; 15 of 16 grounded answers shown | 0 shown, 90% shown |
| `eval:agent-safety`     | 28 of 28 held; no violation                         | 0 violations       |

Before this sub-phase: API e2e 76 suites and 806 tests, admin e2e 24 tests, `@suskii/shared`
378 tests. Not run: no model, no vendor and no supplier was called; the evals ran on recorded
answers, and the staff agents still have no eval of their own (planned in H).

**Decisions needed from the owner**

- The documents the assistant should answer rules from, as text or Markdown, and who keeps
  them current.
- Whether everyone with the assistant's pages may open travellers' conversations (masked and
  audited), or fewer people.
- The model prices (`AGENT_MODEL_PRICES`), and the forecast above which someone is told.

### G. Clients (2026-11-11)

**Built**

- **Copy.** The assistant, price requests, what the assistant remembers, the rating question
  and the PDF links in the five catalogs (English serves three locales), checked like every
  string for placeholders, plural forms and English left behind.
- **The website.** The chat on `/assistant` with a signed-in traveller's earlier
  conversations, result cards (an indicative price is marked as one), a source card for a
  document, the confirmation card a traveller taps, thumbs on an answer and a rating out of
  five once the assistant has answered. It is reached by a server-rendered link in the top
  bar and the phone menu, so no other page carries its code. Price requests on `/quotes` and
  `/quotes/{id}`: ask, read the verified offer with its terms and how long it can be booked,
  withdraw, book through the ordinary checkout, save as a PDF. An assisted item's summary at
  checkout and on the booking page. What the assistant remembers on
  `/assistant/preferences`. "Save as a PDF" on a combined trip.
- **The app.** The assistant screen and its history with a Maestro flow; price requests
  under Account (`/account/quotes`), with the push path for an answered request and app
  links for `/quotes`; an assisted item's summary at checkout and a paid one shown as
  waiting for a person on the trip screen; what the assistant remembers
  (`/assistant/preferences`); the rating; and PDFs of a price request and a combined trip,
  read with the account's session, handed to the share sheet and deleted from the cache when
  it closes.
- **The assistant on WhatsApp** (ADR-084, ADR-101). A traveller's message is stored in its
  support conversation as before. With `AGENT_WHATSAPP_ENABLED` (off unless set, also outside
  production) and the assistant on, reachable and not paused, it answers there as a guest's
  run: searches, rules from the knowledge base and the FAQs, the status page; nothing that
  needs an account or a tap. Its first answer says it is automated and that a person is one
  message away. A person's reply, a handover, `AGENT_WHATSAPP_MAX_REPLIES` answers (12) or
  any failure ends its part: it writes the handover once and the thread is for people. STOP,
  the 24-hour window and the template stay the channel's own. Support keeps a list of
  answerers (`WhatsAppAnswerers`) the assistant registers with, so support still never
  imports it, and the after-hours assistant (ADR-085) answers when nobody takes the message.
- **Five tools**, 43 in all: `fares.trend` (the route's facts and how the last 30 days
  compare with the 60 before, said as a trend and never a forecast), `documents.passports`
  (how many saved passports last six months after arrival, as counts only),
  `company.policy` (the caller's own company's travel rules), `memory.read` and
  `memory.remember` (the sixth tool that needs a tap).
- **A handover that says more** (`support.handover`): the support conversation's own reply
  target as text and whether it is in a priority queue, which the assistant may give as an
  aim and never a promise; and an internal note for the team with the agents that worked on
  the conversation and the tools they called with how each ended (names and codes only).
- **Consented memory** (ADR-105): table `agent_memories` and
  `user_preferences.assistant_memory_at` (migration `20261124120000_agent_memory`), four
  routes under `/v1/me/assistant-memory`, five named preferences (home airport, cabin,
  window or aisle, up to three airlines, price or comfort first), each a code or one of a
  fixed set. Nothing is kept until the traveller switches it on; switching it off erases all.
- **A rating and a funnel** (ADR-106): `PUT /v1/agent/conversations/{id}/rating` (1 to 5,
  the caller's own conversation, once the assistant answered), and on the console's quality
  page the scores with their mean and what travellers' conversations led to (answered,
  searched, asked a person for a price, asked to confirm, confirmed, handed over).
- **PDFs** (`pdf-lib`, as booking documents): `GET /v1/quotes/assisted/{id}/pdf` and
  `GET /v1/trips/{id}/pdf`, the caller's own, with a QR code to the page they come from and
  no name, contact or payment detail. Each says what it is not: an offer is not a booking, a
  plan is not a booking, an unpaid part is not reserved, a price seen elsewhere was a
  reference.
- **The journeys with the assistant off.** `E2E_AGENT=off` starts the website's test stack
  without it; a CI step runs the assistant, search and booking suites on that stack.
- Three migrations (49 in all), the tools snapshot of the evals, the new table in the data
  registry, the export, account deletion and the records of processing.
- Documents: amendments to ADR-080, ADR-084, ADR-099, ADR-101, ADR-104, ADR-105, ADR-106 and
  ADR-107, section 7.5 of the launch checklist, the data classification, access control and
  business limits pages, the store forms.

**How to try it** (local stack; no model, no vendor and no Meta account is called)

1. `pnpm infra:up`, `pnpm --filter @suskii/api db:deploy`, `db:seed`, `db:seed:demo`, then
   `pnpm dev`, which also starts the agent service with its sample model
   (`AGENT_MODEL_PROVIDER=mock`). The website's top bar shows "Assistant".
2. **Chat.** Ask "what is the status?": the sample model reads the status page through the
   tool gateway and answers; anything else gets its one fixed sentence. The rating appears
   under the answer. (`AGENT_SERVICE=mock` answers inside the API instead, without the agent
   service.)
3. **Preferences.** Sign in, open "What the assistant remembers" from the chat, switch it
   on, choose a seat, type `LOS` as the home airport. Switch it off: everything is erased.
4. **Price requests.** Open `/quotes`, ask for a price (a phone number in the text is
   refused before anything is sent). In the console, "Assisted quotes", make an offer. Back
   on the website the request shows the offer: "Save as a PDF", then book it through the
   ordinary checkout.
5. **A trip as a PDF.** Plan a trip on `/trips`, add a part, "Save the plan as a PDF".
6. **The app.** `pnpm --filter @suskii/mobile android`: Account offers the assistant and
   price requests; the same journeys run there.
7. **WhatsApp.** `agent-whatsapp.e2e-spec.ts` runs the whole exchange against the mock
   channel (a signed inbound message, the answer, a person taking over, the reply limit,
   STOP). A real number needs the owner's Meta app (launch checklist, section 6 item 2 and 7.5).
8. **Off.** Start the API with `AGENT_ENABLED=false`: no page links to the assistant,
   `/assistant` answers 404, and search and booking work as before.

**What changed from the plan**

- **The entry is a link, not a button that opens a dialog.** The dialog put the homepage 565
  bytes over its 170 kB script budget (ADR-043). A server-rendered link costs no script on
  any other page.
- **No meal preference is remembered.** A meal request can reveal religion or health
  (ADR-093) and waits for counsel; the list has no free text at all, so nothing personal can
  be written into it.
- **WhatsApp answers as a guest, and asks for no confirmation.** A contact is never linked
  to an account by its phone number (ADR-084), so nothing that needs an account runs there,
  and a confirmation is tapped in the app or on the website, never agreed to in a chat. A
  run that ends in one becomes the handover.
- **The plan PDF is the combined trip's**, with the parts chosen, their prices and where
  each stands: the records, not a model's itinerary.
- **The data saver changes nothing in the chat**: it loads no pictures; cards are text.
- **Thumbs existed since D**; this sub-phase adds the score out of five for a conversation.
- **Moved to H**: shadow mode and prompt versions compared before they answer; a recipe
  proposal for a site in drift; the eval results in the console; the forecast alert.

**The hard lines, as the clients keep them**

- A client shows what the API stored: an answer the guard passed, cards a tool built, a
  confirmation card built by `prepare()`. No client composes an answer or a price.
- "Confirm" is the only way a commit tool runs, on the website and in the app, and goes out
  with an `Idempotency-Key`. WhatsApp has no confirm.
- An indicative price is marked as one on every channel, WhatsApp included, and has no link
  to book; it is sold only through a price request a person verifies.
- The clients say an assisted booking waits for a person after payment; nothing tells a
  traveller that a booking or a payment succeeded before the records say so.
- Nothing about search, booking or payment asks whether the assistant is on. The suites that
  prove it run on a stack without it.

**Found while building, and fixed**

- **The chat dialog broke the homepage budget** by 565 bytes (the entry is now a link).
- **A handover on WhatsApp would have opened a second support conversation** beside the
  thread the traveller is already in. `support.handover` opens nothing on that channel and
  answers that the thread is with the team.
- **A page writer that cut long text.** The PDF writer printed one line per call, so terms a
  person typed would have been cut at the margin. It wraps running text and keeps line
  breaks.
- **The web console guard** failed two new tests on responses that are meant to be refused
  (an invalid airport code, the assistant's pages while it is off); the tests name the
  expected refusals.
- A reused test database kept another run's audit rows, so one count in the trips suite was
  off there; on a fresh database the suite passes. The audit log is append-only by design.
- **The gate caught a list I had not updated.** A test asks that every route with an id in
  its path either proves another account gets 404 or says why nobody owns what it names.
  The five new ones were in neither list, so the first full run of the API suite failed
  there. The two PDFs and the rating are now called by another account, by a guest and
  without a session (404, or 401 without a session), and the two preference routes are
  listed with their reason: the path names a preference, and the rows are the caller's own.

**Known limits, kept in view**

- **WhatsApp has no language setting.** The assistant's fixed lines there (the disclosure,
  the handover, the greeting) are English; the model answers in the language it is written
  to.
- **The rating is one score for a conversation**, asked on the website and in the app, not
  on WhatsApp.
- **The fare trend needs five days with a fare in each window**; on thin data the tool says
  nothing about a trend.
- **The passport reminder is a general rule** (six months after arrival), not the
  destination's own; the tool says so and decides nothing about entry.
- **Nothing in code stops a model from wording a trend as a forecast**, or a passport
  reminder as a decision about entry: the tools' descriptions and the fixed sentences they
  return say what each is, and the guard checks figures and outcomes, not tense. The new
  tools have unit and end-to-end tests and no eval case of their own; cases for them (a
  trend is not a forecast, a meal is never remembered, a reminder is not a guarantee) join
  the evals in H, before the live run.
- **The app's price requests and preferences have unit tests and no Maestro flow of their
  own**; the assistant's flow and the phone check cover the chat.
- **The app's full Jest run prints "A worker process has failed to exit gracefully"** once.
  The run passes; no open handle was traced to a test of this sub-phase. Kept as an open
  item for H.

**Test results** (local, 2026-11-11). The long suites ran on commit `1d7df5e`, the last one
that changes what the API, the website and the app do. The API suite had one failure there
(the ownership list above); its fix is in the test file alone (`9484cad`), and that suite was
run again on it. Every workspace's unit tests, the formatting and the checklist ran on the
head of the branch with these documents. The pull request's checks run everything once more
on the head.

| Check                                                  | Result                                   | On        |
| ------------------------------------------------------ | ---------------------------------------- | --------- |
| `pnpm lint`                                            | 15 of 15 workspaces                      | `1d7df5e` |
| `pnpm typecheck`                                       | 14 of 14 workspaces                      | `1d7df5e` |
| `pnpm test` (unit, every workspace)                    | 12 of 12 tasks                           | head      |
| API unit (`test:cov`, with the 80% gates)              | 76 suites, 818 tests                     | `1d7df5e` |
| API e2e (full, `test:e2e:cov`)                         | 80 suites, 855 of 856 tests              | `1d7df5e` |
| the ownership matrix after its fix                     | 3 of 3 tests                             | `9484cad` |
| of which the assistant on WhatsApp                     | 8 tests                                  | `1d7df5e` |
| of which the planning tools                            | 6 tests                                  | `1d7df5e` |
| `@suskii/agent`                                        | 58 tests (10 in the three evals)         | head      |
| `@suskii/shared`                                       | 390 tests                                | head      |
| `@suskii/i18n`                                         | 34 tests                                 | head      |
| Web e2e (Chromium and slow 3G)                         | 254 tests, 1 skipped (the off-mode case) | `1d7df5e` |
| Web e2e with the assistant off (`E2E_AGENT=off`)       | 43 tests                                 | `1d7df5e` |
| Mobile (Jest)                                          | 53 suites, 351 tests                     | `1d7df5e` |
| Admin e2e                                              | 31 tests                                 | `1d7df5e` |
| `pnpm check:migrations` (49 migrations)                | pass                                     | head      |
| `pnpm security:checklist --check`, `pnpm format:check` | pass                                     | head      |
| `pnpm test:scripts`                                    | 13 tests                                 | `1d7df5e` |

| Eval (recorded answers) | Result                                              | Pass mark          |
| ----------------------- | --------------------------------------------------- | ------------------ |
| `eval:agent-routing`    | 78 of 81 (96.3%); 16 by rule without a model call   | 95%                |
| `eval:agent-grounding`  | no invention shown; 15 of 16 grounded answers shown | 0 shown, 90% shown |
| `eval:agent-safety`     | 28 of 28 held; no violation                         | 0 violations       |

Before this sub-phase: API e2e 78 suites and 840 tests, API unit 74 suites and 808 tests, web
e2e 242 tests, mobile 50 suites and 319 tests, admin e2e 31 tests, `@suskii/shared` 385 tests.
Not run: no model, no vendor, no supplier and no Meta account was called; the evals ran on
recorded answers and have no case yet for this sub-phase's tools (planned in H); the Maestro
flows run in CI, not here; no phone was used.

**Decisions needed from the owner**

- Whether the assistant answers on WhatsApp (`AGENT_WHATSAPP_ENABLED`), after how many
  answers it hands over (12), and who reads the handovers out of hours.
- Whether a meal preference may be remembered (counsel, ADR-093).
- The reply targets a handover may name (`SUPPORT_SLA`).
- The wording of the PDFs' notes ("not a booking", "to be confirmed") from counsel.
- Whether a guest may use the assistant, or only signed-in travellers.
