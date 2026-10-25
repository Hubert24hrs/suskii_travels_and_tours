# ADR-061: AI trip search

- Status: Accepted
- Date: 2026-10-25
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec's optional phase 13 adds a natural-language search box. An LLM turns the text into the
shared flight search schema, the traveller sees the result as editable form fields, and any
failure falls back to the manual form
(`PROJECT_SPEC.json#/features/ai_features_optional_phase`). It asks for:

- a fast, low-cost model behind a cloud-agnostic `LlmProvider` interface;
- temperature 0 and strict schema validation;
- no personal data sent to the model;
- prompt-injection safety: the model's output is data, never executed;
- a per-user rate limit and cost cap;
- a feature flag;
- an eval of 50 queries with at least 95% exact-match accuracy.

Two facts constrain the design:

- **Sampling parameters are gone.** Since API version 2026-10-21 the Messages API rejects
  `temperature`, `top_p` and `top_k` on every model. Before that, Claude Haiku 5.5 already
  accepted only the defaults.
- **No key is available.** No LLM credential exists in this repository, and no test may call a
  real provider.

## Decision

### Shape of the feature

- **Endpoint.** `POST /v1/flights/natural-search` takes the text and the visitor's time zone. It
  returns a draft of the flight form, never a search: places from our catalog, dates, travellers,
  cabin and flags, plus the fields still missing.
- **Clients.** The website and app fill their existing form and the traveller submits it. Every
  value the model produced is visible and editable before money or a supplier call is involved.
  - **Website.** A "Describe your trip instead" button on the flight tab opens the box, whose
    code loads only then; its request code and the API client load when it opens. The homepage
    pays 0.4 kB for the button (169.1 to 169.5 kB, under the 170 kB of ADR-043), where an
    always-open box cost 0.6 kB and left 0.3 kB of headroom.
  - **App.** The same button opens the box above the flight form while the API says the
    feature is on. One button row keeps the form, and the Maestro flows that drive it, in place.
  - **Notices.** A filled form says what is still missing ("the departure date") and the month
    a text named without a day; every failure keeps the text and points to the form.
- **Availability.** `GET /v1/flights/natural-search` says whether the box is available
  (`{ enabled, maxLength }`), so clients hide it while off.
- **Flag.** `AI_SEARCH_ENABLED` follows the Cars rule: on outside production, off in production
  unless set. While off, the status route answers `enabled: false` and the parse route 404.

### Model and provider

- **Interface.** `LlmProvider` exposes one method: `extract()` takes a system prompt, the input
  and a JSON schema, and returns a JSON object plus token usage. Domain code never sees a vendor
  type.
- **`AnthropicLlmProvider`.**
  - Uses the official `@anthropic-ai/sdk`, confined to the adapter (the repository's supplier
    rule). The SDK gives typed errors, retries and request shapes that track API changes, which a
    hand-written client would have to follow by hand.
  - Pinned to 1.1.0: the newest release past the 3-day dependency cooldown, on API version
    2026-10-21.
  - Its `fetch` is wrapped with `redirect: 'error'`, with a timeout (`LLM_TIMEOUT_MS`) and one
    retry.
- **Model.** `claude-haiku-5-5` ($0.10 input / $0.50 output per million tokens), the fast,
  low-cost class the spec names. `LLM_MODEL` switches it (for example to `claude-sonnet-5-5`)
  if the eval says so; prices are settings too.
- **`MockLlmProvider`.** Deterministic and offline, for tests and development. Production refuses
  it unless `ALLOW_MOCK_PROVIDERS` is set.

### Determinism without temperature

- **Structured outputs.** `output_config.format` carries our JSON schema, so the response must
  parse into exactly that shape.
- **Effort `low`.** A short extraction needs little thinking. Adaptive thinking stays on, as the
  model's guidance recommends over disabling it.
- **Fixed examples.** A system prompt with fixed rules and worked examples, cached; it exceeds the
  model's 512-token minimum.
- **Volatile data in the user turn.** The visitor's date, weekday and time zone go in the user
  turn, after the cache breakpoint.
- **Server-side validation of everything.**
  - The JSON is checked against a Zod schema.
  - A place counts only if it resolves through our catalog. The model's IATA code is accepted
    only when it is a real airport; otherwise the place's name is searched, and a city resolves
    to its first large airport.
  - Dates must fall between the visitor's today and `MAX_ADVANCE_DAYS`. A return date must not
    precede departure.
  - Traveller counts must satisfy the shared rules.
- **No failure for partial answers.** A value that fails validation is dropped into `missing`, so
  the traveller fills it in.

### Guardrails

- **Personal data.**
  - Before the text leaves, `scrubQuery()` replaces e-mail addresses, phone numbers and long
    digit runs (passport and card numbers) with placeholders.
  - The request carries no user id, address or session data.
  - The text is never stored or logged; logs and metrics carry outcomes, latency, tokens and
    cost only.
- **Prompt injection.**
  - The model has no tools and its only output is the fixed schema.
  - The system prompt tells it to treat the text as data. A request to do anything other than
    describe a flight yields `understood: false`.
  - The worst a hostile text can do is fill the form with values the traveller sees before
    searching.
- **Cost cap.** Kept by `AiSearchBudget` in Redis, in integer micro-dollars per UTC day:
  - **Scope.** Per signed-in user, or per guest by an HMAC of the address
    (`AI_SEARCH_USER_DAILY_MICROUSD`), plus a global cap (`AI_SEARCH_GLOBAL_DAILY_MICROUSD`).
  - **Reserve.** Each request atomically reserves its worst case before the call: the prompt's
    input tokens plus `max_tokens` of output, at the configured prices.
  - **Settle.** After the call the reservation settles to the actual cost from `usage`, cache
    reads and writes included. A timeout keeps the reservation, since the provider may still
    bill.
  - **Over the cap.** 429 `ai-search-budget-exceeded`.
- **Rate limits.** `@RateLimit` per address and per user, on top of the cost cap.
- **Fallback.** Every failure is a problem detail the clients treat as "use the form":
  - 422 `ai-search-not-understood`;
  - 429 for budget and rate limits;
  - 503 `ai-search-unavailable`, covering timeout, provider error, refusal, truncated or invalid
    output.

  The typed text stays in the box.

### Evals

- **Fixture.** `apps/api/test/fixtures/natural-search-eval.json` holds 50 cases at a fixed today
  (2026-11-02, `Africa/Lagos`), each with the expected normalised draft.
- **Runner.** `pnpm --filter @suskii/api eval:natural-search` runs them through the configured
  provider and the whole pipeline, catalog included. It prints mismatches, accuracy, tokens and
  cost, and fails below 95%.
- **In CI.** An e2e test runs the same pipeline with recorded model answers and must match all 50.
  That proves resolution, validation and normalisation, not the model.
- **Against the real model.** A manual workflow (`ai-eval.yml`) runs the eval once the owner adds
  `LLM_API_KEY`.

## Consequences

- **Accuracy is unmeasured until the owner runs the eval.** One run costs about a cent. If Claude
  Haiku 5.5 scores below 95%, raise the effort level or move `LLM_MODEL` up a tier and re-run.
  The 95% figure is checked by the eval, not assumed.
- **A new third-party processor.** Anthropic receives the scrubbed text. It goes in
  `external-communications.md`, the data classification and the app privacy forms; its retention
  terms (standard or zero data retention) are an owner decision.
- **Bounded spend.** The global cap is the most a day can cost. A traveller who hits their cap
  still has the form.
- **Determinism is not absolute.** Without sampling controls, the same text can occasionally
  parse differently. The schema, validation and editable fields keep that harmless, and the eval
  measures it.
- **Hotels and other verticals are out of scope** (the spec names the flight search). The
  interface takes any schema, so another vertical needs its own prompt, schema and eval, not a
  new provider.
