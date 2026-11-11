# Adding a web-data vendor or a site to read

Two different jobs. A **vendor** (a scrape provider) is code: an adapter a developer writes. A
**site** (a source) is data: staff add it in the console, and a person approves it with a
recorded basis before anything of it is read. Background: ADR-102; the rules that apply to
every change are in `CLAUDE.md` under "Price intelligence"; what to do when something goes
wrong is in `docs/runbooks/price-intelligence.md`.

What never changes, whichever you add:

- A price read from a website is an observation, never an offer. It is shown as indicative
  with when and where it was seen, and sold only through an assisted quote a person verified
  (ADR-104).
- Every site starts in `review`. Whether reading a site is lawful, and whether its terms allow
  it, is a decision of the owner and counsel. Code records the decision; it does not make it.
- No code of ours solves a challenge, rotates identities or hides who is reading.
- No test and no CI job calls a vendor.

## Part 1. A site (no code)

Done in the console, Data sources, by staff with `datasources:manage`.

### 1. Read the site's own rules first

Open the site's `robots.txt` and its terms of use. For each, record what it says about
automated access: `allowed`, `silent` or `disallowed`. `unknown` is the default and can never
be approved: someone must have read both.

If either says `disallowed`, only the site's own word is a basis: a licence, or a written
permission. An assessment or a note from counsel cannot overrule what the site says
(`basisIssue()` in `@suskii/shared`). Ask the site, or leave it out.

### 2. Add the site

| Field                                | What to enter                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domain                               | The site's own domain. It never changes afterwards: a site's rules do not move to another site                                                                                                                                                                                                                 |
| Products                             | What its pages price: `flight`, `hotel`, `car`, `transfer`, `tour`                                                                                                                                                                                                                                             |
| Country, currency, locale, time zone | The market its prices are for, and the site's own time zone                                                                                                                                                                                                                                                    |
| A page address per product           | An `https` address on the site's domain with placeholders in braces: `{origin}`, `{destination}`, `{place}`, `{placeSlug}`, `{from}`, `{to}`, `{adults}`, `{children}`, `{rooms}`. The API builds every address it fetches from this template and checked values; nobody and no model ever supplies an address |
| A recipe per product                 | How a price is read from that page (below)                                                                                                                                                                                                                                                                     |
| Vendors, in order                    | Who may read it once approved. Only vendors enabled in this environment (`PRICE_INTEL_VENDORS`) are ever called                                                                                                                                                                                                |
| Highest proxy class                  | `none`, `datacenter`, `residential` or `unblocker`. The router never goes above it. Start at `none`                                                                                                                                                                                                            |
| Rate and concurrency                 | Requests a minute (6 unless you say otherwise) and how many at once (1). Slow is polite and cheap                                                                                                                                                                                                              |
| Night window                         | Two hours of the site's local day (1 to 5 unless you say otherwise). Scheduled reads run only inside it; a read someone asked for runs at any hour                                                                                                                                                             |
| What the robots file and terms say   | From step 1                                                                                                                                                                                                                                                                                                    |
| Vendor settings                      | Only what one vendor needs for this site: an Apify actor and its input, a Browse AI robot and its input parameters. Never a key: a name that looks like a credential is refused, and keys live in the environment                                                                                              |
| Freshness per product                | How long an observation answers without a new read                                                                                                                                                                                                                                                             |

### 3. Write the recipe

A recipe has a version and up to four methods, tried in order. It reads only a fixed list of
public fields (`PUBLIC_ITEM_FIELDS`: a title, a brand, stars, a room type, a carrier, times, a
vehicle class and the like), a price, a currency and an availability. Nothing about a person
can be stored, whatever the page holds.

| Method            | Use it when                                                                            | What you give                                                                     |
| ----------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `structured_data` | The page declares its items as schema.org data. Try this first: it survives a redesign | The types to read (`Hotel`, `Product`, `Flight`, `Car` and the like), ten at most |
| `selectors`       | The prices are only in the page's markup                                               | The CSS selector of one priced item, and inside it a selector for each field      |
| `vendor_fields`   | The vendor extracts the fields itself (a Browse AI robot, an Apify actor)              | For each field, the path in the item the vendor returns (`price.amount`)          |

Give the recipe a version you will recognise (`hotel-v1`). Every observation records the
version that read it. State whether the site's prices include taxes and fees when its pages
say so.

### 4. Try it while it is in review

A site in review is answered by the mock only, whatever vendors it names: nothing of the real
site is fetched. Use Read on the site's page to check that the address builds and the recipe
parses what the mock returns.

### 5. Approval

Approving is its own action, with step-up: the basis (`licence`, `permission`,
`public_data_assessment`, `counsel_note`) and a reference to where it is written down (a
document id, a ticket; not a contact detail). It is audited with who approved and on what.

Changing what the approver agreed to (the vendors, the highest proxy class, the robots and
terms findings, the page addresses, the rate or the concurrency) sends an approved site back
to review. Changing a recipe does not: a recipe is how a page is read, not what was agreed.

Then print the register for counsel:
`pnpm --filter @suskii/api price-intel:register` (`docs/legal/scraping-register.md` is the
blank page; the command prints this environment's sites).

### 6. Afterwards

- Set a budget for the site if the defaults ($2 a day, $20 a month) do not fit (step-up).
- Watch "How reading has gone" for the first days: the share of usable pages, the share the
  site refused, the cost per price kept. Many refusals mean the site does not want to be read:
  lower the rate or stop, never raise the proxy class without a new approval.
- When the site changes its pages, the drift alert tells staff once. The price intelligence
  assistant in the console can prepare a recipe from the page that was kept (a rule works it
  out from the page's schema.org data; no model reads the page). The proposal waits in
  Approvals for someone other than the person who asked. If nothing can be proposed, write the
  new selectors and a new version yourself.

## Part 2. A vendor (code)

An adapter maps one vendor's API to `ScrapeProvider`
(`apps/api/src/price-intel/scrape-provider.ts`). Read the vendor's current documentation and
SDK first, and write fixtures from them: the adapters in the repository follow the vendors'
published SDKs and none has been run against a live account from here.

1. **The name.** Add it to `SCRAPE_VENDORS` in `packages/shared/src/price-intel.ts`.
2. **Its prices.** An entry in `DEFAULT_SCRAPE_COSTS` (`apps/api/src/config/env.schema.ts`): what
   one page costs per proxy class, in millionths of a US dollar. They decide when a budget
   stops reading, never what anyone is charged. A class without a price is a class the router
   never uses with this vendor. The owner overrides them with `PRICE_INTEL_COSTS`.
3. **The adapter.** `apps/api/src/price-intel/providers/<vendor>-scrape-provider.ts`:
   - `capabilities`: whether it renders pages, the proxy classes it offers, whether it can exit
     in a chosen country, whether it returns extracted fields.
   - `run(request, signal)`: one call. Honour the `AbortSignal`. Use the helpers in
     `providers/scrape-http.ts` (`redirect: 'error'`, a timeout, https only). Return a
     `ScrapePage`: the page, or the fields the vendor extracted, and the cost if the vendor
     reports it.
   - Throw `ScrapeError(vendor, failureClass)` for everything that goes wrong, with one of the
     seven classes (`blocked`, `timeout`, `provider_error`, `quota_exhausted`,
     `empty_or_unrendered`, `parse_failed`, `policy_denied`). The router has one reaction per
     class (`FAILURE_REACTIONS`), so the class you choose decides what happens next. Never
     retry inside the adapter, and never put a key, a page or a question in the message.
   - `health(signal)`: a call that fetches no page and says whether the key works.
   - `estimateCostMicroUsd()`: from the costs it was given.
   - The vendor's types stay in this file.
4. **Its settings.** The key in the env schema (optional), with a boot check that refuses the
   vendor in `PRICE_INTEL_VENDORS` without its key; the same names in `.env.example` (a
   placeholder, never a real key), in Terraform (`extra_secrets` and a Secret Manager value) and
   in the Helm values. Wire the adapter in `enabledProviders()` in `price-intel.module.ts`.
5. **What only it needs for a site** (an actor, a robot) goes in the site's `vendorSettings`,
   checked in `price-sources.service.ts`; a setting named like a credential is refused.
6. **Tests.** Cases in `providers/providers.spec.ts` from fixtures: a good page, each refusal
   the vendor can give mapped to the right failure class, a spent quota, a timeout, a broken
   answer, and that the key never appears in an error. The router's own behaviour
   (`provider-router.spec.ts`) needs no new case: it works on failure classes.
7. **The owner's check.** A section in `apps/api/scripts/scrapers-sandbox.ts`
   (`sandbox:scrapers`, the `scrapers-sandbox.yml` workflow): the key works and, with
   `--own-page`, one page of Suskii's own site is read. Never another site.
8. **The documents, in the same change.** A row in
   `docs/security/external-communications.md` (purpose, what is sent, authentication, timeout,
   the setting); the vendor in the register's generator (`scraping-register.ts`) and in
   `docs/runbooks/price-intelligence.md`; the owner's steps in
   `docs/owner/launch-checklist.md`. A vendor receives page addresses and nothing about a
   person, so it is not a recipient in the records of processing; if that ever changes, it
   becomes one in the same change.
9. **Contract and console.** Vendor names are an enum in the API's contract: run
   `pnpm --filter @suskii/shared build && pnpm generate:api`, commit both generated files, and
   add the vendor's label to the console's catalog (`packages/i18n/src/admin.ts`).

A vendor that is in the code is not in use: it reads nothing until `PRICE_INTEL_VENDORS` names
it in an environment, its key is there, and an approved site lists it.

## Before the pull request

```sh
pnpm --filter @suskii/shared test
pnpm --filter @suskii/api test -- src/price-intel
pnpm --filter @suskii/api test:e2e "price-intel"
pnpm lint && pnpm typecheck
```
