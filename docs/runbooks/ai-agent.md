# The assistant (Suskii Agent)

**Alert:** `AssistantRunsFailing`, `AssistantAnswersRefused` or `AssistantMonthlyCost`; an
operations email or a log line `operations alert` with kind `assistant cost`; staff or
travellers saying the assistant answers wrongly, slowly or not at all.
**Console:** Assistant (pause, levels, one agent's switch), Assistant activity (runs, traces,
conversations), Assistant cost and quality (cost, forecast, quality, evaluations, limits),
Approvals, Audit log with `?area=assistant`.
**Background:** ADR-101 (the agent service and the tool gateway), ADR-105 (its data), ADR-106
(models, prompts, evals, shadow mode), ADR-107 (what an agent may do).

Search, booking, payment and support by people never depend on the assistant. Stopping it
loses only the assistant: the website and the app hide it, and every journey works as before.
When in doubt, pause first and look afterwards.

## What happens automatically

- **A model call that fails** because the provider was unavailable or too slow is tried once
  more, on the fallback model (`AGENT_MODEL_FALLBACK`). A request the provider rejected (a bad
  key, a bad request) is not tried again.
- **A run that fails** all the same, or cannot reach the agent service, ends with a notice to
  the person asking (`unavailable` or `timeout`), settles what it cost and changes nothing
  else. The run is not repeated: the person asks again.
- **The answer guard** refuses an answer whose figures, contacts or outcomes are not in what
  the tools returned, asks the model once to correct it, and sends a notice (`cannot_answer`)
  if the second answer fails too. No unchecked answer is shown.
- **Limits**: a run has at most 10 model turns, 24 tool calls and 2 minutes. Before its first
  model call it reserves its worst case against the daily caps per person, per guest address
  and in total (UTC days); over a cap no run starts and the person reads the `limit` notice.
- **The monthly figure** (`AGENT_MONTHLY_ALERT_MICROUSD`): the worker has the month's estimated
  cost checked every hour. Operations are told once when the month is heading past the figure
  (after its first three days) and once when it is past it. It only tells: it stops nothing.
- **A paused assistant** starts no run and runs no tool, on every replica, within seconds. If
  the shared record of the pause cannot be read, the assistant counts as paused.

## 1. Stop it now (pause)

1. Console, Assistant, **Pause**, with a reason (`POST /v1/admin/ai/pause`, `ai:manage`). Runs in
   flight end at their next tool call or model turn; nobody new is answered. Travellers who
   write see that the assistant is paused; the preferences page stays open so anyone can
   still erase what it remembers.
2. To stop one agent only (for example `flights` after a bad prompt), switch it off on the
   same page (`PUT /v1/admin/ai/agents/{agent}`, needs a fresh authenticator code). It is
   offered to no run and its tools are refused; the two general agents have no switch.
3. To stop it on WhatsApp only: set `AGENT_WHATSAPP_ENABLED=false` and deploy. Threads go
   back to people.
4. To take it out of the product altogether: set `AGENT_ENABLED=false` on the API and
   deploy. `GET /v1/agent/status` then says it is not available and the clients hide it.

**Releasing** the pause (`POST /v1/admin/ai/resume`) needs a fresh authenticator code and is
audited with who did it. Release only when the cause is known.

## 2. The model provider is down or slow

Signs: `AssistantRunsFailing`; runs with outcome `model_error` or `timeout` in Assistant
activity; the provider's own status page.

1. Check the provider's status page and the agent service's log: `model call failed:` with
   `unavailable`, `timeout` or `rejected`. The log never holds a prompt or an answer.
2. If it is the provider (`unavailable`, `timeout`): wait, or pause (section 1) so travellers
   read "paused" instead of failing one by one. The fallback model is the same provider's;
   there is no second provider to fail over to today. Adding one is an adapter behind
   `AgentModel` and a run of the three evals against it (ADR-106).
3. If only the agent service is unhealthy (its `/ready` answers 503, people get
   `agent-unavailable`): restart or roll it back (section 6). The API keeps answering
   everything else.
4. `rejected` on every call is most often a spent, revoked or wrong `LLM_API_KEY`, or a model
   name the provider no longer serves. Rotate the key in Secret Manager, or correct the model
   settings, and restart the agent service ([Key rotation](key-rotation.md)).

## 3. The spending caps are reached, or the monthly figure is passed

Signs: people read "today's limit is reached"; `AssistantMonthlyCost`; the email
`[ops] assistant cost`.

1. Open Assistant cost and quality. Every figure there is an estimate: the tokens the models
   reported at `AGENT_MODEL_PRICES`. The provider's invoice is the actual cost; compare the
   two before deciding anything about money.
2. Look at **By account** and **By day**. One account or one day far above the rest is
   abuse or a loop, not growth: open its runs in Assistant activity (traces show tools and
   outcome codes), and suspend the account or pause if it continues. The per-person cap
   already limits what one account can spend in a day.
3. If the growth is real: decide with the owner whether to raise `AGENT_GLOBAL_DAILY_MICROUSD`
   or the monthly figure. Both are deployment settings; neither is changed in the console.
4. If prices changed at the provider, update `AGENT_MODEL_PRICES`: without the right prices
   the caps count the wrong money.
5. Candidate prompts in the shadow have a cap of their own (`AGENT_SHADOW_DAILY_MICROUSD`).
   To stop that spend, clear `AGENT_SHADOW_PROMPTS` or set `AGENT_SHADOW_SAMPLE_PERCENT=0`.

## 4. The assistant answers wrongly

Signs: `AssistantAnswersRefused`; thumbs down and low scores on Assistant cost and quality; a
complaint.

1. Find the conversation in Assistant activity. Staff read it with contact details removed,
   and the read is audited. The trace shows which agent answered, with which prompt version,
   and which tools ran.
2. A wrong figure or outcome that was **shown** is the serious case: the guard should have
   refused it. Pause, keep the conversation's reference and the run id, and add the case to
   the grounding or the safety eval before any fix ships (section 5).
3. Many refused answers (`guard_blocked`) with nothing wrong shown means a prompt or a tool
   drifted from what the guard expects: travellers get notices instead of answers. Switch the
   agent off (section 1) or roll the prompt back (section 5).
4. A wrong rule quoted from a document: archive or correct the document in Knowledge. The
   assistant answers from what is there within seconds.
5. Whatever the cause, a traveller who was told something wrong gets a person: answer through
   support, and correct it in writing.

## 5. Roll a prompt or a model back, and ship a change safely

Prompts are versioned records in the agent service's code (`apps/agent/src/prompts`), and the
model of each role is a setting of that service. Neither is edited in the console.

1. **Roll back**: deploy the previous agent image ([Deploy and roll back](deploy-and-rollback.md)).
   The prompt versions a run used are on the run (`router@1`, `flights@2`), so quality by
   prompt version on Assistant cost and quality shows the change taking effect.
2. **Before a new prompt, tool or model answers anyone**: the three evals pass on recorded
   answers in CI, and are run against the model with the owner's key
   (Actions, Agent evals, Run workflow). Record the results in the console (Assistant cost and
   quality, Evaluations, Record a run) so the measurement has a date, a commit and a name.
3. **Try it in the shadow first** when the change is a prompt: ship the new version as a
   candidate, name it in `AGENT_SHADOW_PROMPTS` with a small `AGENT_SHADOW_SAMPLE_PERCENT`,
   and compare how it does on real turns (it answers nobody and calls no tool). Promote it by
   making it the live version in code and removing it from the setting.
4. A recorded answer in an eval that is wrong on purpose stays wrong: the tests name them.
   Never edit a case to make a suite pass.

## 6. The agent service itself

It is a separate service with its own image, no route to the database's `public` schema and
one way into the platform, the tool gateway.

1. Health: `/health` says the process is up; `/ready` says it can keep conversations' working
   state (its checkpoint store). The API's own readiness never depends on either.
2. Roll back or restart it like any service ([Deploy and roll back](deploy-and-rollback.md)).
   Conversations and their history live in the API's database and are not lost; a run in
   flight during a restart ends as failed and the person asks again.
3. If its token may have leaked (`AGENT_TOOLS_TOKEN`, `AGENT_RUN_TOKEN`): pause, rotate both
   in Secret Manager, restart the API and the agent service, release
   ([Key rotation](key-rotation.md)). A tool call still needs a sealed grant of a live run, so
   a token alone reads nothing; rotate all the same.

## 7. A site's pages stopped reading (parser drift)

The alert and the levers are in [Price intelligence](price-intelligence.md). The assistant's
part: the price intelligence assistant can prepare a recipe from the page that was kept when
nothing could be read (a rule works it out; no model reads the page). The proposal waits in
Approvals for someone other than the person who asked, who may manage data sources. Approving
saves it as that person's change and closes the incident; if nothing can be proposed
(`nothing_priced`), a person writes the selectors on the site's page in Data sources.

## Afterwards

- Confirm the alert has cleared and a test conversation in the console's staff chat answers.
- Write the review (see the runbooks' index). For a wrong answer that was shown, the review
  names the eval case that now covers it.
