# ADR-101: A separate agent service, sealed grants and the tool gateway

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for one LangGraph.js agent system across the website, the app and the
  console), Claude Code (implementer)

## Context

An agent run is long, streamed and bursty: several model calls and tool calls for one question.
The booking API must not slow down or fail because of it, and the model must never be the thing
that decides whose data is read. The repository already separates a worker from the API
(ADR-011): the worker has no database access and acts only through `/v1/internal`.

## Decision

### A third service, `apps/agent`

A new workspace (Node ESM, like the worker) runs the LangGraph graphs as its own Cloud Run
service with internal ingress. It holds three things only: the model provider's key, a token for
the tool gateway, and a connection to the `agent` database schema for checkpoints (ADR-103). It
has no Redis, no application tables, no supplier or payment credentials and no web-data vendor
keys. It is never reached from the internet: only the API calls it.

The API stays the only place where truth lives and changes: bookings, payments, refunds and the
ledger keep their owners (`BookingTransitions`, `PaymentEventsService`, `LedgerService`). The
agent reads, proposes and explains (ADR-107).

### One request, end to end

1. A client calls `POST /v1/agent/chat`. The API authenticates it, checks the flag, the pause
   switch, the rate limits and the cost budget, stores the message and creates a run.
2. The API mints a **grant** and calls the agent service (`POST /runs`, token `AGENT_RUN_TOKEN`)
   with the thread id, the scrubbed message and the grant.
3. The agent streams events back to the API as newline-delimited JSON: text, tool starts and
   ends, cards, an interrupt, the end, or an error.
4. Every tool call goes from the agent to the API's **tool gateway** with the grant.
5. The API writes each event to the run's log, relays it to the client, records usage and cost,
   and stores the answer.

### The grant is sealed, and the agent cannot read it

A grant is a short-lived capability the API seals with `FieldEncryption` (context `agent-grant`):
its id, the caller (a user id, or a guest conversation), the caller's roles, the conversation,
the scopes this run may use, and its expiry (the run's time limit plus a margin). The agent
passes it back, unopened, with each tool call. The gateway opens it, refuses an expired or
unknown one, and takes the caller from it.

So the model never supplies a user id, a role or an owner, and cannot learn one: no prompt holds
them. A signed token the agent could read was rejected for that reason, and because it would put
a verification key in a second service for no benefit.

Beside the grant the API sends a small **context** that grants nothing: locale, display currency,
channel and which agents are on. It only shapes prompts and routing.

### The tool gateway is the only door

`/v1/internal/agent-tools/{tool}` takes the agent's own token (`AGENT_TOOLS_TOKEN`, checked in
constant time; the worker's `INTERNAL_API_TOKEN` does not open it, nor the other way round) and a
grant. `AgentToolRegistry` in the API lists every tool with its tier (ADR-107), the scopes it
needs, a Zod schema for its arguments and one for its result, and a handler that calls existing
services as the grant's caller. The gateway checks, in order: the tool exists, the grant is
valid, the scope is in the grant, the tier is allowed for this caller and autonomy level, the
arguments parse. Then it runs the handler, filters the result through its schema and records an
`AgentToolCall`.

Results are facts under stable keys, never personal values (ADR-105). A refusal is a typed error
the agent shows the model as a failed observation; it is never a reason to retry with other
arguments on the caller's behalf.

### Chat is a stream, with polls beside it

`POST /v1/agent/chat` answers `text/event-stream` when the client asks for it. The run's events
also go to a per-run log in Redis (one hour), so a dropped connection resumes with
`Last-Event-ID`, and a client that cannot stream (Hermes may not) posts the message, gets the run
id and reads `GET /v1/agent/runs/{runId}?after=` every second or two. Both read the same log. A
run finishes and stores its answer whether or not anyone is still listening.

Event streams are not compressed and not cached (`Cache-Control: no-store`), and the route is
not added to `COMPRESSED_PATHS`.

### When the agent is down

`GET /v1/agent/status` says so, chat answers 503 `agent-unavailable`, and clients hide the
assistant. Search, checkout, payment and the console never call the agent service.

## Rejected

- **Agents inside the API process.** One memory and CPU budget and one deploy for booking and for
  long model runs.
- **Giving the agent a database connection to application tables.** Every table would then be one
  prompt injection away.
- **A hosted graph platform.** Conversations would leave the platform and cost would be per run.
- **A general tool protocol server.** The repository already has typed HTTP contracts, guards
  and audit; a second protocol adds surface without adding a control.

## Consequences

- Each tool call is one more hop inside the private network.
- Two new service tokens and one new sealing context to rotate with the others.
- Every action an agent can take is listed in one registry, with a test that the registry holds
  no tool for refunds, captures, payouts, ledger postings or price rules.
- A new route prefix under `/v1/internal`, which the edge already blocks.

## Amendments made while building it

- **Chat answers 202 and the stream is a GET.** `POST /v1/agent/chat` stores the message, starts
  the run in the background and answers `202` with the run id and the stored message. The
  events are read from `GET /v1/agent/runs/{runId}/stream` (server-sent events, resumable with
  `Last-Event-ID` or `?after=`) or polled from `GET /v1/agent/runs/{runId}?after=`; both read
  the same log. A write that streams cannot carry an `Idempotency-Key` answer or be retried
  safely, and the app's fetch does not stream a POST body's answer; a GET can be resumed by any
  client.
- **No words are streamed before they are checked.** The wire between the agent service and the
  API has two events: `status` (which agent, which phase, which tool) and one `end`. An answer
  reaches the API, and a traveller, only after the guard has passed it (ADR-107), so there are
  no text deltas to take back. Clients show the status lines while they wait.
- **What the assistant says without a model is a code.** A greeting, a limit, a timeout, a
  pause and "cannot answer" are notices (`AGENT_NOTICES`); the clients hold the words in their
  catalogs, in the traveller's language. The agent service writes no copy.
- **`AGENT_SERVICE=mock`** runs an assistant inside the API that says one fixed sentence, for
  tests and for a stack without the agent service; production refuses it unless mocks are
  allowed. With it the API needs no `AGENT_URL` and no run token.
- **A run whose answer cannot be stored is closed as failed** and its last event sent, so a
  conversation never looks busy until the time limit; its spend reservation stands, since the
  model may have been billed.
- **The service has no route for a caller without the API's token**: it answers 404, as the
  API does for a route that is switched off.
- **The website's entry is a link** (sub-phase G). A button that opened the chat in a dialog
  put the homepage 565 bytes over its script budget (ADR-043). The top bar and the phone
  menu carry a server-rendered link to `/assistant`, shown only while the status says the
  assistant is available: no script on any other page, and the chat's code loads only where
  the chat is. The app offers it from Account on the same answer.
- **Three channels, one run.** `web` and `app` start a run with `POST /v1/agent/chat`;
  `whatsapp` starts it from the support inbox (`AgentChatService.answerWhatsApp`, ADR-084)
  and waits for the run's end, since there is no client to poll. The grant's channel is the
  one the conversation was opened on; a tool may read it (`support.handover` opens nothing
  on WhatsApp) and never a model's word for it.
- **Off means absent.** With the assistant off, `/assistant` and `/assistant/preferences`
  answer 404 and nothing links to them; the app shows no entry. The website's assistant,
  search and booking suites run in CI on a stack started without it (`E2E_AGENT=off`).
- **Delivery, built and not applied** (sub-phase H). The agent service has its own image
  (`apps/agent/Dockerfile`, as the worker's: pruned workspace, production dependencies only,
  the `node` user, a read-only root file system). `/health` says the process is up and
  `/ready` that it can keep threads; the image's health check and the platform's startup
  probe use `/ready`, the liveness probe `/health`, so a database blip never restarts it.
- **On Cloud Run** (`deploy_agent` in Terraform) it is a service with internal ingress only,
  no load balancer backend, its own identity, its own database URL written by Terraform, and
  the secrets it reads and no others (its two tokens, the model provider's key). The invoker
  IAM check is off: the API presents the run token, as the worker presents its own to the
  API's internal routes, and only traffic from the VPC arrives at all. An IAM-checked hop
  (the API sending a Google identity token) would be stronger and is not built: it puts
  cloud-specific code in the API's client. The operator copies the service's address into
  `AGENT_URL`; Terraform does not derive it, because the API and the agent each need the
  other's address and two services cannot wait for each other.
- **Its secrets are its own.** In the compose rehearsal the agent service is given a file
  with its two tokens and none of the API's keys. `keys:generate` prints the two tokens.
- **The rehearsal proves the wiring, not a conversation.** The compose release rehearsal has
  the database step create the agent's role, waits until the service is ready (its role
  reads its checkpoint tables), and checks each door from the inside: the run door answers
  the run token (400 for a request that is not a run) and does not exist for any other token
  (404); the tool gateway lists its tools to the tools token and refuses the run token and
  no token (401). A whole conversation through the real service is the API's
  `agent-service.e2e-spec.ts`; a guest's chat in the rehearsal would have called Cloudflare's
  Turnstile, which that stack verifies for real.
- **The Helm chart** carries the service as an optional component (`agent.enabled`), with a
  network policy that lets in the API only. The kind rehearsal does not include it.
