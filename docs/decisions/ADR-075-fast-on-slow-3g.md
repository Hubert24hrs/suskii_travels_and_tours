# ADR-075: Fast on slow 3G

- Status: Accepted
- Date: 2026-10-27
- Deciders: owner (the goal), Claude Code (design)
- Context: [ADR-013](ADR-013-homepage-performance-and-js-budget.md),
  [ADR-043](ADR-043-homepage-javascript-at-170-kb.md),
  [ADR-044](ADR-044-measuring-web-performance-in-the-lab-and-the-field.md)

## Context

Most of our travellers are on mobile data, often on slow 3G and mid-range Android phones. The owner
asked for search results in under 3 seconds on such a phone and network, and for a data-saver
mode. The homepage already has a JavaScript budget and a Lighthouse gate, but nothing measured
the search itself, which is what travellers wait for.

Measured before this change, on the throttled phone profile below, the website took 8.4 seconds
from pressing Search to the first fare (median of three runs). Where the time went:

- The results page asked the API twice for the same first page. The search answers with its first
  page, but the website and the app discarded it and fetched it again.
- Search answers (64 kB here) left the API uncompressed. In production Cloudflare compresses them;
  locally and on the hosted test server nothing did.
- The browser downloaded the 60 kB tab icon (a 512 px PNG) twice while the search ran, competing
  for the same slow connection.

## Decision

1. **What we measure.** "Slow 3G" is WebPageTest's "3G Slow" profile: 400 kbit/s down and up and
   400 ms round trip, emulated in Chrome. "Mid-range Android" is a 4x CPU slowdown on a 360 x 640
   screen (Playwright's Moto G4). The 3 seconds run from pressing Search on the open homepage to
   the first fare on screen. Supplier time is outside the budget: the e2e stack's mock suppliers
   answer at once, and real supplier latency is watched in production (search metrics, ADR-047).
2. **One round trip per search.** The website and the app show the page the search answers with.
   They ask the search for another page only when the sort, the filters or the page change.
   `POST /v1/flights/searches` and `POST /v1/hotels/searches` take `limit` (1 to 50, default 20)
   for the size of that first page.
3. **Compressed public answers.** The API compresses (Brotli, else gzip, above 1 kB) the answers of
   public search, catalog and content reads only: `COMPRESSED_PATHS` in `app.setup.ts`, unit
   tested. Answers that may hold a token or personal data (sign-in, accounts, bookings, quotes,
   payments, admin) are never compressed at the origin, so response sizes cannot reveal a secret
   next to text a caller chose (BREACH).
4. **Connect early.** Every page asks the browser to open the connection to the API
   (`preconnect`, credentialed) while it loads, so a search does not wait for DNS, TCP and TLS.
5. **A small tab icon.** `scripts/brand-assets.mjs` writes a 48 px `icon.png` (2.7 kB) for the
   tab; the install manifest gets its own 512 px icon (`/brand/icon-512.png`).
6. **Data saver.** On the website, the footer's Data saver choice (`__Host-suskii_data_saver`,
   `on` or `off`), or without a choice the browser's `Save-Data: on` signal, asks for 10 results
   per page instead of 20 and draws city art instead of destination photos. In the app, a Data
   saver setting under Account (stored in `preferences`) asks for 10 results per page. Links on
   the website already never prefetch (`AppLink`).
7. **Tested in CI.** The web e2e `slow-3g` project runs the journey three times in fresh browser
   profiles on the throttled phone and fails when the median exceeds 3 seconds. It runs alone,
   after the parallel tests and before Lighthouse. The API e2e checks the first-page size and the
   compressed answer; the app's Jest tests check the single round trip and the data-saver page size.

## Consequences

- Searches cost one round trip instead of two, and the bytes on the wire for a first page drop by
  about 85% where the API compresses them.
- DevTools throttling adds latency per request rather than per packet, so a real phone on slow 3G
  also pays for connection setup; the early connection covers most of that, and field data
  (web-vitals beacons, ADR-044) shows the real distribution.
- Cloudflare compresses production answers at the edge as before, including private ones over
  TLS; the origin rule only limits what the API itself compresses.
- Real supplier time (Duffel answers in seconds) still adds to what travellers see. Streaming
  partial results while slower suppliers answer is a possible next step.
