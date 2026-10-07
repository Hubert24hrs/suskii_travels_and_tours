# ADR-043: Homepage JavaScript at 170 kB

- Status: Accepted
- Date: 2026-10-07
- Deciders: Claude Code (implementer), pending owner review

## Context

`PROJECT_SPEC.json#/performance/web_targets` caps the homepage at 170 kB of gzipped JavaScript.
ADR-013 brought it from 328 kB to 202 kB and left a 210 kB ratchet in the e2e test, with the
target moved to phase 11. At the start of phase 11 the homepage loaded 202.3 kB in 11 scripts
(the test's measure: every script loaded without interaction, gzipped).

About 112 kB of that is React DOM and the Next.js runtime, which we cannot shrink. The rest came
from four places:

- `@suskii/shared` as one bundled file, which Turbopack cannot split;
- Radix tabs and radio group, and downshift, in the search card;
- tailwind-merge, which every `cn()` call pulls in;
- the header's account link, which loaded the API client (openapi-fetch) on every page.

## Decisions

1. **The web app compiles `@suskii/shared` from source.**
   - `next.config.ts` aliases `@suskii/shared` and `@suskii/shared/lite` to their TypeScript
     entries for Turbopack, so a page keeps only the modules it uses.
   - The API, the worker and the mobile app keep the bundled build.
   - `sideEffects` in the package marks `zod-setup.ts` as the only module with side effects.
   - Every schema module imports `z` from `zod-setup`, never from `zod`. The browser's
     `jitless` setting then runs before any schema is built, whatever order the bundler evaluates
     modules in. Without this, Zod probed `new Function` and the strict CSP reported it
     (ADR-013).
   - A unit test fails if any other module imports `zod` directly.
2. **Native tabs, segmented control and combobox.** These replace Radix tabs, the Radix radio
   group and downshift. Each follows its WAI-ARIA pattern:
   - **Tabs:** `tablist`, `tab` and `tabpanel` roles, roving `tabIndex`, arrow keys plus Home and
     End, and controlled or uncontrolled use. Only the active panel renders.
   - **Segmented control:** real radio inputs in a `radiogroup`, so the browser provides keyboard
     handling and form behaviour. The checked style uses `has-checked:`.
   - **Combobox:** ARIA 1.2 (an input with `aria-activedescendant` and a `listbox`). Arrow keys
     open and move, Enter selects, Escape closes, and the highlighted option scrolls into view.
   - The existing interaction, axe and visual tests cover all three, unchanged.
   - Radix stays for dialogs, popovers, toasts and `Slot`, which load on demand or are tiny.
3. **`cn()` without tailwind-merge.**
   - `packages/ui-web/src/lib/cn.ts` resolves conflicts only for the utilities our token theme
     generates, including:
     - the spacing, colour, type, radius and shadow tokens;
     - variants and `!important`;
     - shorthands that override longhands (`p-4` beats an earlier `px-2`, `size-*` beats `w-*`
       and `h-*`, and a font size resets leading).
   - An unknown class is always kept.
   - `cn.node.test.ts` compares it with tailwind-merge, configured with the same theme. It runs
     every ordered pair of classes used in ui-web, web and admin, so a class that resolves
     differently fails the build.
   - tailwind-merge is now only a development dependency of ui-web.
4. **The header no longer loads the API client.** `useSignedIn` lives in its own module
   (`components/account/use-signed-in.ts`), so pages that only show "Sign in" or "Account" do
   not load openapi-fetch.
5. **The budget is the spec's 170 kB.** `HOMEPAGE_JS_BUDGET_BYTES` in
   `apps/web/e2e/performance.spec.ts` is `170 * 1024`; there is no ratchet any more.

## Results (local production build, the e2e test's measure)

| Step                                     | Homepage JavaScript |
| ---------------------------------------- | ------------------- |
| Start of phase 11                        | 202.3 kB            |
| `@suskii/shared` from source             | about 196 kB        |
| Native tabs, segmented control, combobox | about 178 kB        |
| `cn()` without tailwind-merge            | 171.0 kB            |
| Header without the API client            | 167.9 kB            |

## Consequences

- There is little headroom (about 2 kB). A homepage change that adds client code must take
  something out, or load the new code on demand (`lazy()`, `next/dynamic`, `useDeferredOverlay`).
- `cn()` only knows our tokens. A new utility family that can conflict (a new theme key, say)
  needs a group in `cn.ts`; the equivalence test reports it as soon as a component uses it.
- The three components are now ours to maintain. Their behaviour is pinned by the interaction,
  axe and visual tests in ui-web and by the web and admin e2e suites.
