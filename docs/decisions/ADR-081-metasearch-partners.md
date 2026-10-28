# ADR-081: Metasearch partners

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Item 8 of the standards plan (growth) asks for metasearch. Engines such as Google Flights,
Skyscanner, KAYAK, Wego and Momondo compare agencies and airlines on one page and send the
traveller to the chosen seller through a deep link. They are paid per click or per booking, and
they hold sellers to quality rules:

- Google Flights asks for a deep link carrying the price to a page that shows the selected
  itinerary and flight numbers (a search results page can be rejected), at least 95% of links
  working and at least 90% of prices matching on arrival, measured by crawlers that sample
  thousands of itineraries a day. Partners below the bar are suspended. With a live API, the deep
  link comes back with the price; Google does not call a second API to build links.
- Skyscanner and Wego onboard agencies by agreement, with the technical format agreed per
  partner.

Sources: [Google transport partner requirements](https://developers.google.com/travel/transport/guides/partner-integration/participation-requirements),
[Google Flights partner help](https://support.google.com/travel/answer/9905232).

Suskii already prices guests' searches with markups, fees and service taxes (ADR-008, ADR-072),
caches searches (ADR-009) and re-checks prices with the supplier before checkout.

## Decision

1. **Partners and keys.** A staff member with `pricing:manage` creates a partner in the console
   (name, code, limits) after a recent authenticator check (`@StepUp()`). The API answers with a
   key, `smk_` and 43 base64url characters (32 random bytes), shown once. Only its HMAC
   (`metasearch-key`) is stored, with the first 12 characters for recognition. Rotating replaces
   the HMAC, so the old key stops at once; deactivating stops the partner's API access. Creation,
   rotation and changes are audited (`metasearch_partner.*`).
2. **Live API.** `GET /v1/metasearch/flights` takes the route, dates, travellers, cabin, currency
   and direct-only flag as query parameters and the key in `X-Api-Key`. It answers with up to
   the partner's `maxResults` itineraries, cheapest first: every segment (carriers, flight
   numbers, airports, local and UTC times), cabin, baggage, refund and change conditions, the
   all-in total for all travellers, a validity time and the deep link. Prices are the website's
   guest prices (channel `web`, no member benefits), because the link lands on the website. The
   supplier's name and cost never leave the API. Partner traffic shares the search cache but
   writes no search analytics row.
3. **Limits.** Each partner has requests per minute and per day (defaults 60 and 20,000),
   counted in Redis sliding windows and answered with 429 and `Retry-After`. Requests without a
   valid key are counted per address (20 per minute) before the database is asked. The route
   skips the per-address limits, which would cap a partner's single egress address.
4. **Deep links.** `{WEB_APP_URL}/flights/go/{token}`, where the token seals (AES-256-GCM,
   context `metasearch-link`) the partner, the search request, the itinerary key (flight numbers,
   departure instants, cabin, fare brand), the shown total and currency, and the issue time. It
   holds no personal data and cannot be altered. After `METASEARCH_LINK_TTL_HOURS` (24) the
   price promise lapses: the landing offers the same search instead.
5. **Landing.** `POST /v1/metasearch/landings` opens the token, finds the itinerary in the
   current results for its request (cache or a fresh search), quotes it with the supplier in the
   token's currency and compares the quote's total with the shown one: `same`, `lower`,
   `higher`, `unavailable` (sold out, gone or past) or `expired`. A signed-in Prime member may
   see `lower`. It records a `metasearch_landings` row (partner, outcome, shown and landed totals)
   and ties the quote to it in one transaction; a booking made from the quote copies the
   landing. The website's `/flights/go/[token]` goes straight to checkout on `same` and `lower`,
   shows the old and new totals before continuing on `higher`, and offers the same search on
   `unavailable` and `expired`. The page is private and never indexed.
6. **Reporting.** The console lists partners with 30 days of landings by outcome, price
   accuracy (same or lower among landings that found the flight), link success (landings that
   found the flight among all) and bookings with their value per currency (committed statuses
   only, never converted). Read access is `reports:read`.
7. **Formats.** The JSON API is the canonical format. Each engine's own format (Google's
   partner API, Skyscanner's or Wego's) is a thin mapping over it, added when the agreement is
   signed and its specification is in hand.

## Consequences

- Price accuracy is measured from day one, per partner, before the partner measures it.
- A rotated or leaked key is stopped in one step; the HMAC in the database is useless alone.
- Supplier costs from partner volume are bounded by the per-partner limits and the shared
  cache. The owner should set limits per partner from the supplier's look-to-book terms.
- Partner prices are the website's guest prices. Channel-specific prices for metasearch (a
  common lever) would need a new sales channel carried through the sealed link; not built.
- Hotels on metasearch (Google Hotel Ads, Trivago) use price feeds and are a separate decision.
- `robots.txt` keeps generic crawlers off `/flights/go/` (each visit quotes with the supplier). A
  partner's price-accuracy crawler is allowed by its own user agent once the partner names it.

## Alternatives considered

- **Cached price feeds instead of a live API.** Cheaper on supplier calls, but flight prices move
  too fast for a feed to stay within 90% accuracy, and Google prefers live APIs for flights.
- **Deep links to the search results page.** Simpler, but Google rejects links that make the
  traveller choose the flight again, and accuracy cannot be measured per itinerary.
- **Keys as JWTs or stored encrypted.** A random key checked by HMAC needs no signing key
  management and cannot be recovered from the database; nothing needs to read it back.
- **A connectivity provider in front of the engines.** Adds a per-booking fee and another vendor
  between the engines and our prices; worth revisiting only if per-engine formats become a burden.
