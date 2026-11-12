# Phase 13: AI trip search (optional)

Status: built; the 95% criterion needs one run of the eval against the real model (owner's key)

## Goal

A natural-language search box ("cheap flight to Dubai in December for 2 adults") that an LLM
turns into the shared flight search form, shown to the traveller as editable fields before
anything is searched (`PROJECT_SPEC.json#/features/ai_features_optional_phase`).

## Acceptance criteria (from PROJECT_SPEC.json)

1. At least 95% exact-match parse accuracy on the eval set (50 natural-language queries with
   their expected parsed structs).
2. Graceful fallback on failure.
3. Per-user cost cap enforced.

Task: implement the feature behind a feature flag, with the evals.

## Starting before phase 12's acceptance

The execution protocol starts a phase only once the previous one meets its acceptance criteria.
Phase 12 is built and rehearsed, but its criteria (a tagged release deployed to staging and
production, store submissions) need the owner's GCP, Cloudflare, Expo and store accounts. The
owner asked to start phase 13 on 2026-10-25 with that still open; phase 12 stays "built,
acceptance needs owner accounts" in CLAUDE.md.

## What the survey found

- **The form to fill.** `createFlightSearchFormSchema` (`packages/shared/src/search.ts`):
  one way, round trip or 2-5 multi-city legs; IATA airport codes; ISO dates checked against
  today and `MAX_ADVANCE_DAYS`; traveller counts with the infant rule; cabin class; direct only;
  flexible dates. The web form and the app form hold airports as `{ code, name, city,
countryCode }`; cities expand to their airports.
- **Place resolution exists.** `CatalogService.suggest()` ranks airports and cities by trigram
  similarity with the primary-market boost; a city lists its airports, large ones first.
- **Patterns to reuse.** Provider abstract classes with mock adapters refused in production unless
  `ALLOW_MOCK_PROVIDERS` (`FxProvider`, `MapsProvider`, ...); feature flags that are on outside
  production and off in production unless set (`CarsFlags`); `@RateLimit` policies; Redis; metrics
  in `telemetry/metrics.ts`; HMACs for personal values (`HmacService`).
- **No LLM code or dependency yet.** The spec's environment example names `LLM_PROVIDER` and
  `LLM_API_KEY`.
- **The API changed under the spec.** The spec says temperature 0. Since API version 2026-10-21
  the Messages API rejects `temperature`, `top_p` and `top_k` on every model (and Claude Haiku
  5.5 accepted only the defaults before that). Determinism comes from structured outputs (a JSON
  schema the response must match), a low effort level and server-side validation instead
  (ADR-061).

## Plan

### A. Shared schemas and copy (`packages/shared`, `packages/i18n`)

- `naturalSearchRequestSchema`: the text (3-280 characters after trimming), the visitor's IANA
  time zone (validated, default `Africa/Lagos`).
- `naturalSearchResultSchema`: a draft of the flight form (trip type, origin, destination,
  dates, a month when only a month was given, multi-city legs, travellers, cabin, direct only,
  flexible dates; places as `{ code, name, city, countryCode }`), plus the fields the traveller
  still has to fill. Never a search request: the client fills its form and the traveller
  submits it.
- Copy for the box, its states and the fallback notices in every locale (web and app).

### B. API (`apps/api/src/ai-search`)

- `LlmProvider` (abstract): `extract({ system, input, schema, maxOutputTokens, signal })` returns
  the parsed JSON object and token usage. Adapters:
  - `MockLlmProvider`: deterministic, no network; recorded answers for known texts and a small
    pattern parser for development. Refused in production unless `ALLOW_MOCK_PROVIDERS`.
  - `AnthropicLlmProvider`: the official `@anthropic-ai/sdk` (1.1.0, the newest release past the
    3-day cooldown) confined to the adapter; `claude-haiku-5-5` by default (`LLM_MODEL`);
    structured outputs with our JSON schema; effort `low`; a cached system prompt; the visitor's
    date and time zone in the user turn; `redirect: 'error'`, a timeout and one retry; refusals,
    truncation and invalid JSON become `LlmError`s.
- `TripQueryParser`: scrubs the text before it leaves (e-mail addresses, phone numbers, long digit
  runs such as passport or card numbers), builds the prompt, validates the model's JSON with Zod,
  resolves places through the catalog (a code the model gives counts only if it is a real
  airport; otherwise the name is searched and a city resolves to its first large airport), checks
  dates against the visitor's today and the advance limit, clamps traveller counts to the shared
  rules and drops what does not validate into `missing` instead of failing.
- `AiSearchBudget`: per-day spend in micro-dollars (integers) in Redis, per signed-in user or per
  guest (an HMAC of the address), and a global daily cap. A request reserves its worst-case cost
  atomically before the call and settles to the actual cost from `usage` after it; over the cap it
  answers 429 `ai-search-budget-exceeded`. Prices come from settings.
- Route: `POST /v1/flights/natural-search` (public; `@RateLimit` per address and per user;
  `AI_SEARCH_ENABLED`, which is on outside production and off in production unless set; 404 while
  off) and `GET /v1/flights/natural-search` (`{ enabled, maxLength }`, so clients hide the box
  while off).
  Failures are problem details the clients treat as "use the form": 422
  `ai-search-not-understood`, 429 `ai-search-budget-exceeded`, 503 `ai-search-unavailable`.
- Logs and metrics: outcomes, latency, tokens and cost; never the text.
- Settings: `AI_SEARCH_ENABLED`, `LLM_PROVIDER` (`mock`, `anthropic`), `LLM_API_KEY`,
  `LLM_MODEL`, `LLM_TIMEOUT_MS`, prices per million tokens, `AI_SEARCH_USER_DAILY_MICROUSD`,
  `AI_SEARCH_GLOBAL_DAILY_MICROUSD`. Production refuses `anthropic` without a key and `mock`
  without `ALLOW_MOCK_PROVIDERS`.

### C. Evals

- `apps/api/test/fixtures/natural-search-eval.json`: 50 queries at a fixed today (2026-11-02,
  `Africa/Lagos`) with their expected structs (codes, dates, counts, cabin, flags, or "not a
  flight search"), covering one-way, return, multi-city, relative dates ("next Friday", "this
  weekend"), month-only dates, passenger mixes, cabins, direct flights, Nigerian and other African
  cities, misspellings, non-flight requests and an injection attempt.
- `pnpm --filter @suskii/api eval:natural-search`: runs the cases through the configured
  provider and the full pipeline (catalog included), prints each mismatch, the accuracy, the token
  totals and the cost, and exits non-zero below 95%. Against the real model it needs
  `LLM_API_KEY` and costs about a cent.
- CI: an API e2e test runs the same pipeline with recorded model answers (resolution, validation
  and normalisation must be exact on all 50), plus the fallback and cost-cap cases. A manual
  workflow (`ai-eval.yml`) runs the real-model eval when the owner adds the key; it fails at its
  first step naming the missing secret otherwise.

### D. Clients

- Website: a "Describe your trip" box on the flight tab, rendered only when the API says the
  feature is on, its code loaded on demand (homepage JavaScript budget, ADR-043). A successful
  parse fills the form's fields and marks what is still missing; the traveller edits and submits
  as usual. Any failure keeps the text and shows the form with a short notice.
- App: the same box above the flight search form, with Jest tests.

### E. Docs and settings

ADR-061; security docs (`external-communications.md`, `data-classification.md`,
`business-limits.md`, `crypto-inventory.md`, threat model); the app privacy forms
(`docs/release/data-safety.md`: the text goes to an AI processor and is not stored); `.env.example`,
Terraform and Helm settings; CHANGELOG; CLAUDE.md.

## Risks

- **Accuracy is unproven until the owner runs the real-model eval.** No LLM key exists here and
  no test may call a real provider. CI proves the pipeline around the model; the 95% criterion
  needs `LLM_API_KEY` and one run of the eval (or the manual workflow). If Claude Haiku 5.5 falls
  short, raise the effort level or switch `LLM_MODEL` (to `claude-sonnet-5-5`), then re-run.
- **Cost.** Bounded by the per-user and global daily caps and the rate limits, reserved before
  each call.
- **Prompt injection.** The model has no tools and its output is data: a fixed JSON schema,
  validated, with places from our catalog and dates in range. A hostile text can at worst fill
  the form with wrong values the traveller sees before searching.
- **Personal data.** Travellers may type names or numbers; the scrubber removes the common shapes
  and the text is never stored or logged. Anthropic acts as a processor; its data retention terms
  are an owner item.
- **Bundle size.** The website loads the box's code on first focus only.

## Outcome

### Built

- **Shared** (`packages/shared`): request, draft, result and status schemas; the box's constants
  in the Zod-free `lite` entry.
- **Copy** (`packages/i18n`): `search.describe` for the website and app; a `month` date style.
- **API** (`apps/api/src/ai-search`):
  - `POST /v1/flights/natural-search` and its status route;
  - `LlmProvider` with `AnthropicLlmProvider` (the official SDK, structured output, effort `low`,
    a cached prompt) and `MockLlmProvider`;
  - `scrubQuery()`, `PlaceResolver` (catalog-backed), server-side validation into a draft and
    the missing fields;
  - `AiSearchBudget` (reserve and settle in Redis, per user or guest address and in total);
  - rate limits, metrics, settings and the production refusals.
- **Evals:** 50 cases (`test/fixtures/natural-search-eval.json`), the runner
  (`eval:natural-search`) and the manual `ai-eval.yml` workflow.
- **Website:** the box behind a "Describe your trip instead" button on the flight tab.
- **App:** the same button and box above the flight form. The native `Combobox` now shows a selection made
  outside the field, which the fill needs and which also fixes the swap button.
- **Docs:** ADR-061, the security documents, the privacy forms and the settings in
  `.env.example`, Terraform and Helm.

### Acceptance

| Criterion                                | Result                                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| At least 95% exact matches on 50 queries | The pipeline scores 50/50 with recorded model answers (e2e test and `--recorded`). The real model is unmeasured: no key exists here and no test may call a provider. One `ai-eval.yml` run settles it.                    |
| Graceful fallback on failure             | Met: 422, 429 and 503 problem details become notices that keep the text and leave the form usable (API e2e, website e2e, app Jest). With the feature off the box is hidden.                                               |
| Per-user cost cap enforced               | Met: the worst case is reserved before each call against the user's (or guest address's) and the global daily caps, and settled to the billed tokens; over a cap the API answers 429 without calling the model (API e2e). |

### Open items for the owner

- An `LLM_API_KEY` (Anthropic) as a repository secret, then one run of **AI search eval**
  (`ai-eval.yml`, about a cent). Below 95%, raise the effort or move `LLM_MODEL` up a tier.
- The provider's data retention terms (standard or zero data retention).
- Whether to turn the feature on in production (`AI_SEARCH_ENABLED`, `LLM_PROVIDER=anthropic`, the
  key in Secret Manager), and the daily caps (defaults $0.05 per user or address, $20 in total).
