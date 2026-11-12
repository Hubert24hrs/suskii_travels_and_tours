# ADR-013: Homepage performance, on-demand code and the JavaScript budget

- Status: Accepted (the 170 kB budget is enforced since ADR-043)
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 4 requires Lighthouse mobile >= 90 performance on the homepage, and
`PROJECT_SPEC.json#/performance/web_targets` sets LCP <= 2 s, INP <= 200 ms, CLS <= 0.1 and at most
170 kB of gzipped JavaScript on the homepage (budgets are enforced in phase 11).

The first complete build scored 78 (median of three runs) with 328 kB of JavaScript. Lighthouse's
simulated throttling charges every byte and main-thread task that finishes before the first paint
to LCP, so on a fast machine everything the page downloads eagerly counts. Measured contributors:
all of Zod including its locales (93 kB, because `import { z }` defeats tree shaking), the date
picker's calendar (react-day-picker and date-fns), Radix popover and dialog with floating-ui
(25 kB), downshift (13 kB), tailwind-merge (9 kB), inline SVG card art (a third of the DOM, all of
it hydrated) and four preloaded font files.

## Decisions

### Code that is not needed to render loads on demand

- **Validation on submit.** Forms keep controlled state and validate with the shared Zod schemas,
  which load when the form is first focused or pressed and are awaited on submit
  (`apps/web/lib/load-shared.ts`). No React Hook Form: the forms are small, and its resolver would
  still need Zod up front.
- **`@suskii/shared/lite`**: a Zod-free entry with the constants and pure helpers that rendering
  needs (cabin classes, traveller rules, money formatting, locales). ui-web, i18n and the web
  client import it; a unit test fails if anything reachable from it imports Zod. Modules that mixed
  constants and schemas were split (`currency-codes`, `locale-codes`, `traveller-rules`,
  `search-limits`, `money-schema`) and still re-export through the main entry, so API and mobile
  imports are unchanged.
- **Overlays on first open.** `useDeferredOverlay` (ui-web) renders only the trigger; the Radix
  popover or dialog panel loads on first open and is prefetched on hover or focus. The date
  picker's calendar is a separate lazy module. The mobile menu uses the same hook. Focus returns to
  the trigger on close, and pressing the trigger is not treated as an outside click.
- The five non-default search tabs already loaded on demand (ADR-010).

### Zod in the browser

Shared code imports Zod as a namespace (`import * as z from 'zod'`), the form Zod 4 documents for
tree shaking. Browsers set `z.config({ jitless: true })` before any schema is built
(`packages/shared/src/zod-setup.ts`): Zod otherwise probes `new Function`, which the strict CSP
blocks and reports. Servers keep the JIT.

### Lighter pages

- Card illustrations are SVG images from `/art/routes/{from}-{to}.svg` and `/art/cities/{name}.svg`
  (route handlers, token colours, cached for a day, strict document CSP, inputs validated) and load
  lazily. The hero illustration stays inline.
- Only the `latin` font subsets are preloaded; `latin-ext` faces (the naira sign, Yoruba and Igbo
  letters) load through `unicode-range` when a page uses them.
- The sitemap renders on request (`connection()`), so builds never bake in an empty list when the
  API is unreachable.

### Measuring the budget

Homepage JavaScript means the scripts the homepage loads without interaction, gzipped
(`apps/web/e2e/performance.spec.ts`). On-demand chunks are excluded. The Lighthouse gate
(`apps/web/scripts/lighthouse.ts`) judges the median of three runs and fails on a broken trace
rather than scoring it 0.

The homepage currently ships 202 kB: about 112 kB is React DOM and the Next.js runtime, the rest is
the search card (downshift, Radix tabs and radio group), header, filter and newsletter code. The
e2e test enforces a **210 kB ratchet** so the size cannot grow; the spec's 170 kB target moves to
phase 11 (hardening), which owns "performance budgets met". Known ways to close the remaining
~35 kB:

1. Replace downshift with a small purpose-built combobox (about 10 kB).
2. Drop tailwind-merge from client components in favour of variant props (about 7 kB).
3. Defer hydration of the search card until interaction or idle (about 40 kB, but it needs
   server-rendered markup without shipping its code and risks input typed before hydration).

## Results (local, production build, Lighthouse 13.5 mobile preset)

| Metric                 | Before         | After                   |
| ---------------------- | -------------- | ----------------------- |
| Homepage JavaScript    | 328 kB         | 202 kB                  |
| Performance (median)   | 78             | 97 (five runs: 96 - 97) |
| LCP / TBT (median run) | 3.9 s / 390 ms | 2.4 s / 90 ms           |
| Accessibility          | 100            | 100                     |
| Best practices         | 96             | 100                     |
| SEO                    | 92             | 100                     |

## Consequences

- The first open of a picker or menu may wait for a small chunk when it was not prefetched (touch
  devices without focus); a short blank panel appears at most.
- The simulated LCP (2.4 s) is still above the spec's 2 s field target; phase 11 measures field
  data (RUM) against it.
- New client code should import `@suskii/shared/lite` and reach for the main entry only lazily.
