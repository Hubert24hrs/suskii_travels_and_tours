# ADR-106: Agent models, prompts and evaluation

- Status: Accepted
- Date: 2026-11-10
- Deciders: Claude Code (implementer), pending owner review

## Context

`LlmProvider` (ADR-061) asks a model for one JSON object. An agent needs a chat model that calls
tools over several steps, and different steps deserve different models: deciding where a message
goes is cheap work, planning a trip is not. The owner already has one model key (`LLM_API_KEY`)
and may prefer another vendor later.

## Decision

### A model factory in the agent service

`AgentModelFactory` returns a chat model for a role from settings:

| Setting                  | Role                                                  |
| ------------------------ | ----------------------------------------------------- |
| `AGENT_MODEL_PROVIDER`   | `mock`, `anthropic` or `google`                       |
| `AGENT_MODEL_ROUTER`     | a small, fast model: intent, language, classification |
| `AGENT_MODEL_SPECIALIST` | a stronger model: planning and multi-step specialists |
| `AGENT_MODEL_FALLBACK`   | used when the provider fails or is overloaded         |

The default provider is the one already integrated. Model ids and their prices per million
tokens are settings, checked against the vendor's published list when they are set, as ADR-061
does for AI trip search; cost is computed from the usage each call reports, never from an
estimate. `LlmProvider`, AI trip search and the support assistant are not touched.

Obvious messages never reach a model: a rule-based pre-router answers a greeting or opens the
right specialist for a plain "track my booking" before any call is paid for.

### The mock is a model too

`mock` replays recorded model turns (text and tool calls) from fixtures, keyed by prompt id,
version and input. It is the default locally and in tests; production refuses it unless
`ALLOW_MOCK_PROVIDERS=true`. No test calls a model vendor.

### Prompts are versioned records

Each prompt lives in `apps/agent/src/prompts` with an id and a version. Every run stores the ids
and versions it used, so a bad answer leads to the prompt that produced it and a rollback is a
version change. A new agent or prompt can run in **shadow**: beside the live one, on the same
input, answering nobody, with its output kept for comparison.

### Limits on every run

A step limit, a time limit per node and per run, caps on tokens and on tool calls, retries with
backoff only for failures that can pass on a second try, and a message in the traveller's
language when a limit ends a run.

### Nothing leaves for tracing

Runs, nodes and tool calls are recorded in Suskii's own tables and as OpenTelemetry spans
(timings, token counts, outcomes; never message text). Hosted tracing of conversation content is
off, and production refuses to start with it on.

### Evaluation

Three suites, each runnable from recorded model answers (`--recorded`, in CI) and against the
live model (the owner's key, a manual workflow modelled on `ai-eval.yml`):

- `eval:agent-routing`: messages in the seven languages and Nigerian Pidgin, each with the
  specialist it must reach;
- `eval:agent-grounding`: answers with and without fabricated figures, dates, links and numbers;
- `eval:agent-safety`: a red-team corpus (instructions hidden in tool results, pages, documents
  and messages; requests for another customer's data; requests to refund, confirm or pay).

Thresholds are in `docs/phases/ai-agent.md`. A change to a prompt, a tool schema or a model must
keep the recorded suites passing and be re-run live before it answers travellers.

## Rejected

- **Extending `LlmProvider` to chat and tools.** Two working features depend on its small shape.
- **One model for everything.** The router's work does not need the specialist's price.
- **Prompts as strings in code without versions.** A regression could not be traced or undone.

## Consequences

- Model spend is visible per agent, model, customer and workflow, as measured cost.
- A second vendor needs only an adapter in the factory and its prices in settings.
- The live evals wait for the owner's key, like the two existing ones.

## Amendments made while building it

- **Providers are `mock` and `anthropic`.** The `google` provider is not built: no adapter is
  written for a vendor nobody has asked for or holds a key for. Adding one is an `AgentModel`
  adapter and a value of `AGENT_MODEL_PROVIDER`.
- **Prices** are settings of the API, where spend is settled (`AGENT_MODEL_PRICES`,
  `model=input/output/cacheRead/cacheWrite` in micro-dollars per million tokens). The defaults
  were read from the vendor's published price list on 2026-11-10: Claude Haiku 5.5 at $0.10,
  $0.50, $0.01 and $0.125 (prompts up to 100,000 tokens), Claude Sonnet 5.5 at $2, $10, $0.10
  and $2.50. A model the list does not know is charged at the dearest price listed, so a cap is
  reached early and never late. The owner updates the setting when the vendor's list changes.
- **The evals live in the agent workspace** (`apps/agent/src/evals`, fixtures in
  `apps/agent/evals`) and need no API or database: tool results are fixtures, and a gateway
  stand-in makes the real gateway's decisions in the same order. The tool list they run against
  is a snapshot of the API's registry that an API test keeps in step
  (`UPDATE_AGENT_TOOLS_FIXTURE=1` refreshes it). `eval:agent-routing`, `eval:agent-grounding`
  and `eval:agent-safety` take `--recorded`; `agent-eval.yml` runs them against the model with
  the owner's key.
- **Recorded results** at the end of sub-phase D: routing 78 of 81 (three recorded answers are
  wrong on purpose), grounding with no invention shown and 15 of 16 grounded answers shown (the
  miss is the known limit below), safety 28 of 28 held. Languages: English with Nigerian
  Pidgin, French, Portuguese, Swahili and Arabic; the three English catalogs share one prompt
  language.
- **Known limits of the guard, kept in view by the grounding suite**: it refuses arithmetic the
  tools did not do (a correct "two rooms would be" is refused, so tools return totals), and the
  check for instructions read back is word for word, so a paraphrase or a translation passes;
  the instructions hold nothing secret.
- **The sample assistant calls one tool by itself**: asked about the "status", the mock model
  reads the status page through the gateway, so a stack without a model shows the service, a
  grant and the gateway working together (`agent-service.e2e-spec.ts`).
