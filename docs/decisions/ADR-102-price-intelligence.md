# ADR-102: Price intelligence, the source order, source policies and failover

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (asked for prices where no supplier API exists, through Firecrawl, Apify,
  Browse AI, Oxylabs and Bright Data with automatic failover), Claude Code (implementer)

## Context

Supplier APIs do not cover everything Suskii's travellers ask for: many independent hotels, local
car rental companies, and flights on carriers the flight supplier does not return. The owner
wants the agent to answer those with prices read from public web pages.

Reading prices from other companies' sites carries legal and contractual risk that code cannot
remove. What code can do is make every decision about a site explicit, recorded and enforced, and
keep the reading polite, cheap and bounded.

## Decision

### Where a price comes from, in this order

1. Supplier APIs and Suskii's own inventory.
2. Licensed feeds and affiliate programmes already in the catalogue (ADR-069).
3. Web data, only for what 1 and 2 cannot price.
4. A person: an assisted quote (ADR-104).

When a supplier starts to cover an item, web data stops being asked for it.

### A module in the API, jobs in the worker

`apps/api/src/price-intel` is a supplier-style module: it reuses the supplier error types, Redis,
pricing, audit and the data registry. Scheduled crawls are worker jobs that call
`/v1/internal/price-intel` (the ADR-011 pattern). The agent service holds no vendor key and
reaches price intelligence only through tools.

### Every site has a policy, and starts closed

`SourcePolicy` is one row per domain: its status, the market it serves (country, currency,
language), the ordered vendors that may read it, the highest proxy class allowed, its request
rate, the local night window for scheduled reads, how long an answer stays fresh per product,
what its robots file and terms say about automated access, and how prices are extracted.

- `status` is `review` (the default), `approved` or `blocked`. In production only `approved`
  domains are read. A `blocked` domain is never read, by any vendor, in any environment.
- Approving is a staff action with step-up and an audit entry, and it records a **basis**:
  `licence`, `permission`, `public_data_assessment` or `counsel_note`, with a reference. When the
  site's robots file or terms disallow automated access, only `licence` or `permission` is
  accepted.
- `docs/legal/scraping-register.md` is generated from the registry.

### Vendors behind one interface

`ScrapeProvider` (`run`, `health`, `estimateCostMicroUsd`, declared capabilities) has adapters
for Firecrawl, Apify, Browse AI, Oxylabs and Bright Data, a `direct` fetcher for sites whose
policy allows plain requests, and a `mock`. Vendor types stay inside each adapter, each adapter
has a contract test from recorded fixtures, and no test calls a vendor.

### Failover with a reason for every step

The router walks the policy's chain, reordered by measured health per vendor and domain (success
rate, latency, cost per usable record). Every failure is classified and each class has one
reaction:

| Class                                 | Reaction                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `blocked`                             | once more on the same vendor one proxy class higher, then the next vendor |
| `timeout`, `provider_error`           | one retry with backoff and jitter, then the next vendor                   |
| `quota_exhausted`                     | that vendor's breaker opens until its reset                               |
| `empty_or_unrendered`, `parse_failed` | a vendor that renders pages; repeated failures flag parser drift          |
| `policy_denied`                       | stop                                                                      |

A job has hard caps on attempts, time and cost. When the chain is spent the answer is a typed
`ScrapeExhausted`: the caller serves a cached price labelled stale, or hands over to an assisted
quote. Nothing loops.

Breakers are per vendor and per vendor and domain, with state in Redis so every replica agrees.
The supplier breaker (per process) is left as it is. Identical questions share one read
(single flight in Redis).

### Getting past blocks is the vendors' product, within the policy's limit

Suskii's code does not solve challenges and has no evasion code of its own. It chooses among the
vendors' managed options (proxy pools, rendering, unblockers) and owns only: the proxy-class
ladder, which **never exceeds the class the policy's approver allowed** (the default is the
lowest); a proxy exit in the policy's market so prices are the market's own; a token bucket per
domain with jitter, a concurrency cap, `Retry-After` and slow recovery after a 429 or 403;
scheduled reads inside the site's local night; and caches per product with
stale-while-revalidate, never serving stale as fresh. The `direct` fetcher identifies itself
truthfully and obeys the robots file.

### Guardrails in code

- Public, non-personal price data only: no page behind a login, no accounts, no reviewer or
  contact details. `PriceObservation` has no personal field and a test asserts it.
- A request Suskii builds itself passes an SSRF guard: https, a host from an approved policy,
  no private, loopback or link-local address after resolution, no redirect off the host.
- Fetched content is untrusted. Raw HTML or markdown never enters an agent's context. Extraction
  yields schema-validated fields; when a model helps parse a page it runs alone, without tools,
  on text wrapped as data, and its output is validated.
- Kill switches (global, per vendor, per domain) are Redis flags that take effect within seconds.
- Daily and monthly budgets per vendor and per domain, alerts at 50, 80 and 100%, a hard stop at
  100% unless an admin raises it with step-up.
- Production refuses the mock vendor and refuses to read while a domain is not `approved`.

### Observations are judged before they are used

Extraction prefers structured data, then versioned selector recipes, then model-assisted reading.
A price is parsed with `parseMoney` into minor units and a currency, with whether taxes and fees
are inside it. Each `PriceObservation` records the product, a canonical key, the source, the
vendor and proxy class used, the market, when it was read, the price, inclusions, availability,
a confidence score, the parser version and a hash of the page, whose snapshot is kept briefly in
object storage. It is checked for schema, currency sense, outliers against history, freshness
and agreement between sources. A weak one is shown as unverified or dropped.

A rise in parse failures or a fall in confidence for a domain and parser version opens an
incident, moves the domain to its next extraction method, tells staff and proposes a new recipe.
A person approves recipes; nothing approves itself.

## Rejected

- **Our own browsers, proxies or challenge solving.** An arms race the vendors already sell, and
  code that exists only to defeat another site's controls.
- **Reading any site unless told not to.** The default is closed.
- **Putting page text in front of the agent's model.** One hostile page would be an instruction.
- **Web data as a first source.** It is slower, dearer and less certain than an API.

## Consequences

- Nothing is read in production until the owner and counsel approve at least one domain.
- Flights are the most sensitive product for terms and blocking: every flight domain starts in
  `review`, with short freshness and assisted quote only.
- Five vendor accounts, keys and budgets are the owner's to open; until then the mock answers
  locally and in tests.
- New outbound destinations, listed in `docs/security/external-communications.md` with the SSRF
  exception.

## Amendments made while building it (sub-phase C, 2026-11-10)

- **A site in review is answered by the mock vendor only.** Outside production a newly listed
  site can be tried end to end (its page address, its recipe) without a fetch: the mock reads
  nothing real. Production refuses the mock, so there a site in `review` reads nothing, as
  decided above.
- **Proxy classes are `none`, `datacenter`, `residential` and `unblocker`.** A vendor's
  managed-access product (Oxylabs Web Scraper API, Bright Data Web Unlocker, a trained Browse
  AI robot, Firecrawl's stealth proxy) counts as `unblocker`, the highest. A new policy allows
  `none`, and the router uses only classes the owner's price list (`PRICE_INTEL_COSTS`) prices.
- **A page is kept only when nothing could be read from it**, for 7 days, so a person can
  write a recipe for it. A page that was read leaves only its hash on the observation.
- **What sends an approved site back to review**: a change to its vendors, highest proxy
  class, robots or terms finding, page addresses, rate or concurrency. A recipe change does
  not, because a recipe can only read the fixed list of public fields; it is still a staff
  action in the audit log, and it closes an open drift incident.
- **A change carries only what was sent.** Defaults (findings unknown, no proxy, six requests
  a minute, one at a time) apply when a site is created and never when it is changed.
- **Model-assisted reading is not built.** Extraction is structured data, then selector
  recipes, then fields a vendor extracted itself (an Apify actor's items, a Browse AI robot's
  captures, Oxylabs parsing instructions). If a model ever helps read a page, the rules above
  for it stand; today no page text reaches any model.
- **Drift** is counted per site and recipe version over a day in Redis: five or more reads
  that found no price, and at least half of the reads, open an incident, tell staff once and
  start reads at the recipe's second method until a person changes the recipe (or 14 days
  pass, when the count starts again).
- **The vendors' request and answer shapes came from their own published SDKs** (Firecrawl
  `firecrawl` 4.52.0, Apify `apify-client` 2.26.0, Bright Data `@brightdata/sdk` 1.2.0, Oxylabs
  `oxylabs` 3.0.0) and, for Browse AI, which publishes none, from the open-source Pipedream
  and Activepieces integrations. No vendor account existed, so the contract fixtures were
  written from those shapes, not recorded from a live answer. `sandbox:scrapers` with the
  owner's keys is the check that confirms each adapter before its vendor is enabled.
- **The register** is rendered by `price-intel:register` from one environment's registry; the
  repository keeps the page of an empty one.
