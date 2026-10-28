# Fast on slow 3G

Item 4 of the standards plan agreed with the owner on 2026-10-27. Decision record:
[ADR-075](../decisions/ADR-075-fast-on-slow-3g.md).

## Owner's answer this work follows

Search results in under 3 seconds on a slow 3G connection and a mid-range Android phone, a
data-saver mode with smaller images, and offline trips (already built), tested in CI.

## What "slow 3G" and "mid-range Android" mean here

- Network: 400 kbit/s down and up, 400 ms round trip (WebPageTest's "3G Slow" profile), emulated
  by Chrome DevTools in the browser test.
- Device: a 4x CPU slowdown and a 360 x 640 phone screen (Playwright's Moto G4 profile).
- The 3 seconds run from the traveller pressing Search on a page already open to the first result
  on screen. They cover our website and API; the time the airlines' and hotels' systems take to
  answer is measured separately in production (search latency metrics) and is not ours to cut.

## Where the platform stands (measured before the change)

On the throttled phone profile, against the e2e stack built from the base branch:

- Pressing Search on the homepage to the first fare: 8.4 s (median of three runs).
- Opening a results link in a fresh browser: 12.3 s.
- The search answer (64 kB, uncompressed) is fetched twice: the website and the app discard the
  first page the search returns and ask for it again.
- The 60 kB tab icon (a 512 px PNG) downloads twice during the search.

## Plan

| Step | Work                                                                                                                                                             | Files                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1    | Slow-3G journey test: pressing Search on the homepage on the throttled phone profile, median of three runs, fails above 3 s                                      | `apps/web/e2e/slow-network.spec.ts`, `playwright.config.ts` |
| 2    | One round trip per search: the website and the app show the first page the search answers with, and fetch a page only when the sort, filters or next page change | web and app results, flights and hotels                     |
| 3    | Compressed search and catalog answers (Brotli or gzip) from the API, for public search and catalog routes only                                                   | `apps/api/src/app.setup.ts`                                 |
| 4    | Connect to the API early (`preconnect` on every page) and a 48 px tab icon instead of the 512 px one (the install manifest keeps a 512 px icon)                  | web root layout, `scripts/brand-assets.mjs`, `manifest.ts`  |
| 5    | Data saver: a footer choice on the website (else the browser's `Save-Data` signal) and a setting in the app; 10 results per page, city art instead of photos     | web, app, `@suskii/i18n`                                    |
| 6    | The search starts as the form is submitted (the results page picks it up), and the first four cards draw before the filters and the rest of the list             | `lib/search-handoff.ts`, search forms, web results          |
| 7    | Docs: ADR-075, CLAUDE.md, CHANGELOG                                                                                                                              | `docs/`                                                     |

## Risks

- **Emulated, not real, networks.** DevTools throttling adds latency per request rather than per
  packet, so a real slow-3G phone is somewhat slower on connection setup. The budget leaves room
  for that, and field data (web-vitals beacons, ADR-044) shows the real distribution.
- **Compression and secrets.** Compressed responses that mix a secret with attacker-chosen text
  can leak the secret (BREACH). Only public search and catalog answers are compressed at the
  origin; nothing with a token or personal data.
- **Flaky timing in CI.** Shared runners vary; the test takes the median of three runs.

## Outcome

Built as planned (ADR-075). Pressing Search on the homepage to the first fare, on the throttled
phone profile, median of three fresh browsers:

| Step                                                    | Median |
| ------------------------------------------------------- | ------ |
| Before                                                  | 8.4 s  |
| One round trip, compressed answers, early connect, icon | 3.1 s  |
| Search started by the form, first cards first           | 2.1 s  |

The last local run measured 2139, 2113 and 2004 ms. The `slow-3g` Playwright project runs the
journey in CI and fails above 3 s; the API e2e checks the first-page size and compression, and
the app's Jest tests check the single round trip and the data-saver page size.

Tried and dropped: loading the results page's code when the form is first touched. Next.js
splits that code into different chunks for the results route, so the download was wasted.

Open: real supplier time (Duffel answers in seconds) is outside the budget and still adds to what
travellers see; streaming partial results is a possible next step.
