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
