# ADR-112: Ask Suskii on Gemini through Vertex AI, as the machine's own identity

- Status: Accepted
- Date: 2026-11-12
- Deciders: Claude Code (implementer), under the owner's standing instruction to deploy the
  backend and the assistant on Google Cloud and to do everything that does not need the owner
- Amends: ADR-109 (the Gemini adapter and its key), ADR-111 (the backend machine), ADR-106
  (how a model change is evaluated)

## Context

ADR-109 put Ask Suskii on Google's Gemini through the Gemini API, with a key in `LLM_API_KEY`.
That key was the owner's to create in Google AI Studio and to paste into Secret Manager, and
until it existed the deployed assistant answered with the stand-in model. The owner asked for
everything that does not need them to be done for them.

The backend already runs on Google Cloud (ADR-111), as a machine with its own identity. Vertex
AI serves the same Gemini models to that identity, with no key.

Checked against the owner's project on 2026-11-12, from this session and from Cloud Build:

- The project is new, and Google refused it **Gemini 2.5 Flash**, the model ADR-109 named, in
  `europe-west2` (London) and on the global endpoint alike ("your project does not have
  access"). Google serves the 2.5 models only to projects that used them before.
- It served **Gemini 3.5 Flash**, the current Flash model, in London and globally. The adapter's
  own request (system instruction, tools in JSON Schema, a forced call, a thinking level) was
  accepted unchanged, and multi-turn tool calls with ids and thought signatures worked.
- Its list price in Google's Cloud Billing catalogue (Vertex AI, standard text): 1.50 USD a
  million input tokens, 9.00 USD output, 0.15 USD cached input. About five times 2.5 Flash.

## Decision

### Gemini on Vertex AI, with no key

- `AGENT_MODEL_PROVIDER=vertex` makes the Gemini adapter call
  `https://<location>-aiplatform.googleapis.com/v1/projects/<project>/locations/<location>/publishers/google/models/<model>:generateContent`.
  The request and the answer are the Gemini API's own; only the address and the credential
  differ.
- The credential is a token of about an hour from the machine's metadata server
  (`metadataTokenSource()`): kept in memory, replaced five minutes before it ends, one request
  shared by concurrent calls. No key exists anywhere: not in Secret Manager, not in the
  container, not in a file. The release no longer reads `LLM_API_KEY` for this provider.
- `AGENT_VERTEX_PROJECT` names the project billed; `AGENT_VERTEX_LOCATION` the region the
  requests are processed in, `europe-west2` by default, where the machine and its data are.
- The models default to `gemini-3.5-flash` for routing, answering and the fallback. The API
  prices it at the catalogue's rates, so the daily caps measure it.

### One permission

The machine's identity gets a custom role with a single permission,
`aiplatform.endpoints.predict`, and only while the assistant uses Vertex AI. It cannot create
datasets, endpoints, training or tuning jobs, or read anything else of Vertex AI. The build
identity holds the same role so that the evals can run against the model on Cloud Build.

### The evals, against the model

ADR-106 says a model change passes the three evals against the model before it answers
travellers. With no key, they run on Cloud Build as the build identity
(`infra/gcp/cloudbuild.agent-eval.yaml`). The first runs against a real model found four
things, each fixed here rather than worked around, and no pass mark, rule or expected answer
changed for any of them:

1. **The evals had gaps, not the model.** The cases were written as if the model already knew
   what each case expected:
   - `catalog.places` tells a model to resolve every place before a search, and
     `flights.search` takes airport codes only. The cases assumed LOS and ABV, so the eval
     gateway answered the lookup `not_found` and the model apologised or ran out of steps. The
     gateway now answers `catalog.places` from a shared reference (`evals/places.json`, built
     from the repository's airport data with the catalog's own city ids) when a case gives no
     answer of its own, and only that tool.
   - Every bookings case answered `bookings.get` only. A model lists the traveller's bookings
     first, as that tool tells it to, met `not_found` and said it found none: the cases never
     reached the booking. One of them was even counted as an invention, a Swahili "I cannot see
     whether your ticket is confirmed" matching the case's forbidden "confirmed". Each now
     answers `bookings.list` with its own booking.
   - The past-date case said "1 November" on 10 November, and a model searched the next 1
     November, which the fixture still called past. The traveller now names the year.
   - The two booking hand-off cases ("I'll take the Air Peace one") referred to a search the
     eval never showed, so a model rightly asked which flight. They now name the trip and
     answer the searches a model makes, with the ids the hand-off fixtures already used.
2. **Thinking ate the router's limit.** Gemini 3.5 Flash counts its thoughts against
   `maxOutputTokens`; the router's 128 tokens, set for an answer alone, ran out after 110 to
   122 tokens of thought on six of 98 cases, which then went to the concierge. The adapter now
   adds room for thinking on top of the limit the graph asks for (1,024 tokens at the default
   level). Unused room costs nothing.
3. **Markdown.** The model answered in Markdown, which the website, the app and WhatsApp would
   have shown as asterisks and hashes. `plainAnswerText()` takes the draft to plain text before
   the guard reads it: emphasis, headings and rules go, list markers become bullets. It is code,
   not a prompt, so it holds whatever a model writes.
4. **The offer after a booking was held as the prompt read back.** The guard holds an answer
   that repeats twelve words of the instructions in a row (ADR-107). The flights prompt listed
   the rest of the trip as "a place to stay, a car, an airport transfer or travel insurance",
   the very words of the natural question, so every answer that asked it was held and the
   traveller got a notice instead of the booking they had asked for. The bookings prompt had
   the same flaw. The offers now point at what the tool says can be added (`alsoOffer`) and
   name the parts briefly; the guard is unchanged. flights, trip_builder and bookings move to
   version 4, and `prompts.test.ts` holds the questions Gemini wrote against every prompt that
   asks for one.

The run on commit `6364dd7`, on 2026-11-12, against `gemini-3.5-flash` in `europe-west2`:

| Eval      | Result                                                     | Pass mark             |
| --------- | ---------------------------------------------------------- | --------------------- |
| Routing   | 98 of 98 routed (100%), 16 by rule without a model call    | 95%                   |
| Grounding | 16 of 16 grounded answers shown (100%), no invention shown | 90%, and no invention |
| Safety    | 41 of 41 held, no violation                                | every case held       |

It used 888,000 input and 45,000 output tokens: about 1.75 US dollars at the list price.

### Caps on the staging machine

The API's default daily caps are sized for production (50 USD a day in all). On the staging
machine they are 2 USD a day in all, 1 USD per signed-in traveller and 0.20 USD per guest. At the
cap a new message is told the assistant has reached today's limit; nothing else changes.

## Consequences

- The deployed assistant answers with a real model without anything from the owner.
- One key fewer to create, store, rotate and leak.
- Requests stay in London, where the machine and the database are. The records of processing
  name Vertex AI as a recipient; Google's data residency terms for the model are for the
  owner's counsel to confirm.
- A new project's Vertex AI quota is small and shared: the evals met an occasional 429
  ("resource exhausted"), which the graph's one retry on the fallback model absorbed. A busier
  assistant would need a quota increase, a request in the console, not code.
- A run of the three evals costs about 2 US dollars, not cents: the grounding and safety suites
  send each case's tool results back to the model several times. Run them for a change to a
  prompt, a tool or a model, not on every commit.
- The key path (`gemini`, `anthropic`) stays for an environment off Google Cloud and for the
  GitHub eval workflow.
- 3.5 Flash costs more than 2.5 Flash. The caps above bound it; the owner's budget alert on the
  project (50 USD a month) covers everything else.

## Alternatives considered

- **The Gemini API with a key.** Needs the owner to create one; a long-lived secret.
- **The global endpoint.** More capacity, but requests could be processed outside London.
  `AGENT_VERTEX_LOCATION=global` switches to it if capacity matters more than residency.
- **A prompt asking for plain text.** Every prompt's version would change, and a model may still
  write Markdown. The code takes it out regardless.
- **Vertex AI User (`roles/aiplatform.user`).** Far more than calling a model.
