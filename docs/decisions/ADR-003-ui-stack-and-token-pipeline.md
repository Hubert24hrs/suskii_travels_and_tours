# ADR-003: UI stack and design-token pipeline

- Status: Accepted
- Date: 2026-09-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Phase 1 needs one design-token source driving the web (Next.js) and the mobile app (Expo), plus
accessible component libraries for both, with automated proof that components use tokens only, that
axe passes in Storybook, and that colour contrast passes. Tooling at the time of writing:
Tailwind CSS 4.3 (CSS-first config), NativeWind 4.2 stable (Tailwind v3 only; NativeWind 5 for
Tailwind v4 is still RC), Storybook 10.6, Vitest 5.

## Decisions

### 1. One token source, two generated outputs

`packages/design-tokens/src/tokens.ts` is the only place visual values are written. The build
generates:

| Output            | Consumer                    | Format                                                                                                                                                                |
| ----------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme.css`       | web apps, ui-web, Storybook | Tailwind v4 `@theme` with every default namespace the design system owns reset (`--color-*: initial`, spacing, type, radius, shadow, breakpoints, containers, easing) |
| `tailwind-preset` | mobile, ui-native           | Tailwind v3 preset that _replaces_ (not extends) those scales, for NativeWind 4                                                                                       |
| `tokens.css`      | anything outside Tailwind   | `--suskii-*` custom properties                                                                                                                                        |

Because the defaults are removed, utilities outside the design system (`bg-red-500`, `p-7`,
`text-sm`, `rounded-2xl`, `shadow-lg`) never compile. Tests compile both outputs with the real
Tailwind v4 and v3 engines and assert the same token classes exist, and the forbidden ones do not.

The spec asked for "the same Tailwind preset" on both platforms. With NativeWind 4 on Tailwind v3
and the web on Tailwind v4, a literal single preset is impossible. One source feeding two
generated formats, with a parity test, gives the same guarantee. Moving mobile to NativeWind 5 once
it is stable removes the v3 preset (tracked in _Revisit when_).

### 2. Derived tokens beyond the spec

- Accessibility-driven colours: see ADR-004.
- Layout sizes (`size.menu` 320px, `size.popover` 360px, `size.dialog` 560px). The spacing scale is
  reserved for spacing and stops at 80px, so larger fixed sizes are named instead of written as
  arbitrary values.
- A 3px border width on native, for the spec's active-tab underline (Tailwind v4 has it natively).

### 3. Web components: Radix + two focused headless libraries

- Radix primitives (via the `radix-ui` package) for Tabs, Dialog, Popover, Toast, RadioGroup
  (segmented control) and Slot. This is the spec's choice.
- **downshift** `useCombobox` for the airport/city autocomplete. Radix has no combobox, and downshift
  implements the WAI-ARIA 1.2 combobox pattern in about 10 kB.
- **DayPicker** (`@daypicker/react` v10, the package name upstream now recommends) for the
  calendar. Radix has no date picker, and DayPicker is WCAG 2.1 AA with full keyboard navigation and
  date-fns locales.
- React Aria was considered and rejected for bundle size against the 170 kB homepage JS budget.

### 4. Native components: NativeWind 4 + @gorhom/bottom-sheet

NativeWind classes from the shared preset; bottom sheets via `@gorhom/bottom-sheet` 5 (Reanimated 4
and Gesture Handler as bundled with Expo SDK 57); a hand-built, tested calendar grid, because a
native calendar dependency would add more weight than the roughly 100 lines it replaces. SVG icons
take colours and sizes from tokens (`iconColor`, `iconSize`).

### 5. Packaging

`design-tokens` is compiled (tsup, dual ESM/CJS) because Node tools (Tailwind config, tests)
consume it. `ui-web` and `ui-native` ship TypeScript source: their only consumers are bundlers
(Next.js with `transpilePackages`, Storybook/Vite, Metro), and bundling them separately would drop
`'use client'` boundaries.

### 6. No copy inside components

Every user-facing string is a prop (labels, aria labels, summaries, formatted prices and dates).
This keeps i18n in the apps (`packages/i18n` arrives with the first real copy, phase 4) and keeps
server/client boundaries simple.

### 7. Automated accessibility and token checks

- **axe in a real browser**: `@storybook/addon-vitest` 10.6 supports only Vitest 3 and 4, so
  ui-web runs Vitest 5 browser mode (Playwright Chromium) directly. Every story is composed with
  `composeStories`, run (including its play function, so open popovers and dialogs are checked), and
  scanned with axe-core for WCAG 2.0 to 2.2 A/AA at 360px and 1280px. A sanity test proves the
  harness catches contrast and naming failures. Storybook's a11y addon uses the same `test: 'error'`
  setting for interactive review.
- **Keyboard interaction tests**: combobox selection, arrow keys in radio groups and tabs, Escape
  and focus return in dialogs, traveller rules, and date range selection.
- **Tokens-only guard** (both libraries): component source may not contain hex/rgb colours,
  px/rem lengths, arbitrary Tailwind values or literal inline styles.
- **Native**: Jest (`jest-expo`, Jest 29) + React Native Testing Library 14 (async APIs) assert
  roles, names and states.

### 8. Fonts

- Web: `next/font/google` for Plus Jakarta Sans and DM Sans with `latin` + `latin-ext` subsets.
  latin-ext is required for the Naira sign (U+20A6) and the dot-below letters in Yoruba and Igbo
  names. Fonts are downloaded at build time and self-hosted (no runtime requests to Google). The
  cost is a network dependency during `next build`. `next/font/local` cannot assign per-file
  unicode ranges, which would have meant four families and fragile fallback chains.
- Storybook: `@fontsource-variable` packages (offline).
- Mobile: `@expo-google-fonts` TTFs bundled with the app; token font families are per-weight names.

## Consequences

- Designers and developers change one file to restyle both platforms; tests catch drift.
- Two Tailwind majors coexist until NativeWind 5 is stable (named `tailwind3` pnpm catalog).
- CI installs Playwright Chromium (cached) and builds Storybook on every affected change.
- `test-renderer` is pinned to 1.2 and Reanimated's Jest mock is extended with `useReducedMotion`,
  because the latest versions need React 19.3 or lack the export. Both are documented in the workspace config.

## Revisit when

- NativeWind 5 ships stable: move mobile to Tailwind v4, delete the v3 preset and its catalog.
- `@storybook/addon-vitest` supports Vitest 5: consider replacing the custom story runner.
- Expo SDK upgrades: re-check React, test-renderer and the Reanimated mock.
