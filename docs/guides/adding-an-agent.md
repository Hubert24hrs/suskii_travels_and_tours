# Adding an agent, a tool or a prompt version

For developers. Background: ADR-101 (the agent service and the tool gateway), ADR-106 (models,
prompts, evals, shadow mode), ADR-107 (what an agent may do). The rules that apply to every
change are in `CLAUDE.md` under "Suskii Agent" and "The agent service".

An agent is a name, a role in a prompt and a list of tools it may call. It has no code of its
own: the graph (`apps/agent/src/graph/graph.ts`) is the same for every agent, and what an agent
can do is decided by the API's tool gateway from the run's sealed grant.

Before you start, decide two things:

- **Does it need to be an agent at all?** A new ability of an existing agent is a tool with
  that agent in its `agents` list. Add an agent only when the subject needs its own role and
  its own set of tools.
- **What may it never do?** Approving or sending a refund, capturing, paying out, posting to
  the ledger, changing a price rule, confirming a booking and deciding an approval are never
  tools (`isForbiddenAgentTool`). The registry refuses such a name and the API does not start.
  Do not look for a way round it.

## 1. A new agent

Work through the list in this order. The type checker fails at most steps you forget.

| Step               | Where                                                             | What                                                                                                                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The name           | `packages/shared/src/agent.ts`                                    | Add it to `CUSTOMER_AGENTS` (travellers) or `STAFF_AGENTS` (the console). Lower case with underscores. A staff agent also gets its scope in `STAFF_AGENT_SCOPES`; a new scope goes in `AGENT_SCOPES` and, for staff, its permission in `STAFF_SCOPE_PERMISSIONS`              |
| Its role           | `apps/agent/src/prompts/prompts.ts`, `ROLES`                      | One sentence: who it is and what it helps with. The shared rules (`rules`, `staffRules`) are added for it                                                                                                                                                                     |
| Its prompt         | same file, `SPECIALIST_PROMPTS`                                   | `specialist('<name>', 1)` or `staffSpecialist('<name>', 1)`. Without an entry the concierge's prompt stands in, which is never what you want                                                                                                                                  |
| The router's line  | same file, `ROUTER_PROMPT` (travellers) or `STAFF_ROUTES` (staff) | One line saying which messages are its. This changes the router's text: raise the router prompt's `version` in the same change                                                                                                                                                |
| Obvious messages   | `apps/agent/src/graph/pre-router.ts`, `OBVIOUS` (travellers only) | Optional. Phrases, in every language the assistant answers in, that can only mean this agent; they skip the router's model call. A phrase that could mean two agents does more harm than no phrase. Staff runs are never routed by these rules                                |
| Its tools          | `apps/api/src/agent/tools`                                        | Add the agent to the `agents` list of each tool it may call, or write new ones (section 2)                                                                                                                                                                                    |
| Its label          | `packages/i18n/src/admin.ts`, `ai.agents`                         | The console shows agents by name on Assistant, Assistant activity and Assistant cost and quality                                                                                                                                                                              |
| The API's contract | repository root                                                   | `pnpm --filter @suskii/shared build && pnpm generate:api`, and commit `apps/api/openapi.json` and `packages/api-client/src/schema.ts`: agent names are an enum in the contract                                                                                                |
| The tools snapshot | `apps/api`                                                        | `UPDATE_AGENT_TOOLS_FIXTURE=1 pnpm test:e2e "agent-tools"`, then Prettier on `apps/agent/evals/tools.json`. The agent service's evals read the registry from that file                                                                                                        |
| Routing cases      | `apps/agent/evals/routing.json`                                   | At least five messages that are the new agent's, in more than one language, and two that look like its but belong to a neighbour. A staff case has `"audience": "staff"`. `recorded` is what the model answered when you ran it; without a key, the agent you expect it to be |
| Safety cases       | `apps/agent/evals/safety.json`                                    | One case for each thing the agent might be talked into: an outcome it cannot know, a tool outside its grant, a traveller's name (staff agents)                                                                                                                                |
| The security page  | `docs/security/access-control.md`                                 | The tools paragraph states how many tools there are and who calls them                                                                                                                                                                                                        |

A new agent starts at the default autonomy (`supervised`) and switched on. Staff with
`ai:manage` switch it off on the console's Assistant page (step-up, audited); only the two general agents
(`ALWAYS_ON_AGENTS`) have no switch.

A staff agent never answers outside the console, and a traveller's agent never inside it: the
audience comes from the channel in the grant, never from an argument. Do not add an agent to
both lists.

## 2. A new tool

A tool is an `AgentTool` registered by a provider of `AgentModule` (see
`apps/api/src/agent/tools/platform-tools.ts` for the smallest one).

1. **Name and tier.** `area.action`. `read` has no side effect. `propose` prepares something a
   person decides (a support handover, a price request, a row in the approvals queue). `commit`
   changes something of the traveller's own and never runs when an agent calls it: it needs a
   `prepare()` that builds the card and a `run()` that does what the card showed or throws
   `AgentToolError('refused')`.
2. **Scope and agents.** The scope is the part of the platform it opens; a guest's grant has no
   `account` scope and a traveller's has no staff scope. List only the agents that need it.
3. **Input.** A Zod schema. Never an owner, a user id, a role, a scope, an address to fetch or
   an audience: those come from the grant.
4. **What it calls.** The ordinary service, as the grant's caller (`BookingsService.load()` and
   the like, `AgentToolCallers.client(grant)` for prices). Another person's record is
   `AgentToolError('not_found')`. Wrap a service call that can refuse in `guarded()`.
5. **Output.** A Zod schema, and only its fields reach a model. Facts under keys, shaped by
   `tool-support.ts`: money as `{ amountMinor, currency }`, times and lengths as text, a status
   under a key ending in `Status` with a value the guard knows, cards built by `card()`, and
   `problems` as codes. Never a name, a contact detail, a document, a ticket number, a
   confirmation code, a booking reference or a payment detail. A caveat the traveller must read
   is a `note` card with a code (`packages/shared/src/agent-notes.ts`) and its words in every
   catalog, so it is shown whatever the model writes.
6. **Tests.** A case in `test/agent-tools.e2e-spec.ts` (customer tools) or
   `test/agent-staff.e2e-spec.ts` (staff tools): what it returns, that it holds nothing personal,
   that another person's record is `not_found`, and that a guest is refused if it needs an
   account. A `commit` tool also gets a case in `test/agent-confirmations.e2e-spec.ts`: nothing
   happens before the tap, the tap does what the card showed, a changed record refuses it.
7. **A search tool** joins `SEARCH_TOOLS` in `AgentInsightsService`, or the funnel misses it.
8. Refresh the tools snapshot and run the agent service's tests (the table above).

A new kind of proposal for the approvals queue is more than a tool: a value in
`AGENT_APPROVAL_KINDS`, its permission, its schema, a branch in `carryOut()` that calls the
ordinary service as the approver, the console's rendering of it, and cases in
`agent-staff.e2e-spec.ts`. An approval never skips a check the ordinary route makes.

## 3. A new version of a prompt

A prompt is a record with an id and a version (`router@1`, `flights@2`). Every run stores the
versions it used, so the console can show quality by prompt version.

1. Change the text and raise the version in the same commit. Never one without the other.
2. Run the three evals on recorded answers: `pnpm --filter @suskii/agent test`. A recorded
   answer that is wrong on purpose stays wrong; never edit a case to make a suite pass.
3. Run them against the model with the owner's key (Actions, Agent evals, Run workflow) and
   record the result in the console (Assistant cost and quality, Evaluations, Record a run).
4. To try it on real turns before it answers anyone, ship it as a candidate instead of the
   live version: add it to `CANDIDATE_PROMPTS` with the id of the prompt it would replace and
   a higher version, deploy, and name it in `AGENT_SHADOW_PROMPTS` with a small
   `AGENT_SHADOW_SAMPLE_PERCENT`. A candidate answers nobody and calls no tool; the console
   compares how it did with the live prompt on the same turns. Every turn it was tried on was
   one the live prompt answered, so its "answered" share is not an absolute rate.
5. To make a candidate live: move its text and version into the live prompt, remove it from
   `CANDIDATE_PROMPTS` and from the setting, and repeat steps 2 and 3.
6. To go back: deploy the previous agent image (`docs/runbooks/ai-agent.md`, section 5).

## 4. A different model

The model of each role is a setting of the agent service (`AGENT_MODEL_ROUTER`,
`AGENT_MODEL_SPECIALIST`, `AGENT_MODEL_FALLBACK`). A model you change to needs its price in
`AGENT_MODEL_PRICES` on the API: a model without a price is charged at the dearest one listed,
so a cap is reached early, never late. Run the three evals against it before it answers
travellers.

A different provider is an adapter in `apps/agent/src/model/<vendor>-model.ts` behind
`AgentModel`, a value of `AGENT_MODEL_PROVIDER` with a start-up check, a row in
`docs/security/external-communications.md` and a recipient in the records of processing
(`apps/api/src/privacy/processing-records.ts`, then `pnpm --filter @suskii/api privacy:records`).
The SDK retries nothing and hosted tracing stays refused.

## 5. Before the pull request

```sh
pnpm --filter @suskii/shared test
pnpm --filter @suskii/agent test          # the graph, the guard and the three evals, recorded
pnpm --filter @suskii/api test:e2e "agent-"
pnpm lint && pnpm typecheck
```

Update `docs/phases/ai-agent.md` if the catalogue changed, and the runbook if what an operator
does changed.
