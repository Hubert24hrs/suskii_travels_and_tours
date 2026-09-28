# Phase 1: Design tokens and component libraries

Status: complete, awaiting owner review

## Goal

Turn `PROJECT_SPEC.json#/design_system` into one token source that drives the web (Tailwind v4)
and mobile (NativeWind) styling, and build the accessible component libraries every later phase
uses. Nothing in a component may hardcode a colour, radius, font size or spacing value.

## Acceptance criteria (from PROJECT_SPEC.json)

1. All components consume tokens only.
2. axe checks pass in Storybook.
3. Contrast test passes.

## Plan

### `packages/design-tokens` (compiled: tsup + generated CSS)

| File                       | Purpose                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `src/tokens.ts`            | Spec tokens verbatim + derived tokens (ADR-004), typed `as const`                           |
| `src/color.ts`             | Colour parsing, alpha compositing, WCAG relative luminance and contrast ratio               |
| `src/contrast-contract.ts` | Every foreground/background pairing the UI uses, with its WCAG minimum                      |
| `src/tailwind-theme.ts`    | Tailwind v4 `@theme` CSS (web). Default palette and scales removed, so only tokens exist    |
| `src/tailwind-preset.ts`   | Tailwind v3 preset for NativeWind (mobile), from the same tokens                            |
| `src/css-variables.ts`     | Framework-free `:root` CSS custom properties                                                |
| `scripts/generate-css.ts`  | Writes `dist/theme.css` and `dist/tokens.css` at build time                                 |
| Tests                      | Spec parity (values equal `PROJECT_SPEC.json`), contrast contract, web/native output parity |

### `packages/ui-web` (source package, consumed by Next.js and Storybook bundlers)

Components: Button, Input, Tabs, SegmentedControl, Combobox, DateRangePicker, PassengerPicker,
Card, DealCard, DestinationCard, Badge, TrustBar, Skeleton, Modal/Sheet, Toast.

- Radix primitives for Tabs, Dialog (Modal/Sheet), Toast, Popover, ToggleGroup (SegmentedControl).
- downshift `useCombobox` (WAI-ARIA 1.2 combobox) for autocomplete; Radix has no combobox.
- react-day-picker for the calendar grid (keyboard navigation, locale-aware); Radix has no date picker.
- No user-facing copy inside components: every label is a prop, so apps supply i18n strings.
- Storybook 10 (React + Vite) with the a11y addon for interactive review.
- Automated axe: Vitest 5 browser mode (real Chromium) renders every story with `composeStories`
  and fails on any axe violation, colour contrast included. Interaction tests cover keyboard paths.
- Token guard test: fails on hex/rgb literals, arbitrary Tailwind values (`-[...]`) or inline styles.

### `packages/ui-native` (source package, consumed by Metro)

Same component set with NativeWind classes from the shared preset, `@gorhom/bottom-sheet` for sheets
(date, passenger, modal), Reanimated for skeleton pulse (reduced-motion aware), accessibility roles,
labels and states on every interactive element. Jest (`jest-expo`) + Testing Library.

### `packages/shared`

Traveller rules shared by both PassengerPickers and the phase 4 search schema: adults 1-9, children,
infants <= adults, total <= 9, with `canIncrement` / `canDecrement` helpers and a Zod schema.

### App wiring (proves the pipeline end to end)

- `apps/web`, `apps/admin`: Tailwind v4 via PostCSS importing the generated theme, fonts self-hosted
  with `next/font/local` from `@fontsource-variable` files (no build-time network), shells restyled
  with tokens only.
- `apps/mobile`: NativeWind (babel, metro, tailwind config with the shared preset), fonts from
  `@expo-google-fonts`, gesture handler and bottom-sheet providers, home shell styled with tokens.

### CI

Install Playwright Chromium (cached) for the ui-web browser tests; build Storybook to catch broken
stories.

## Risks and mitigations

| Risk                                                                                                                                                              | Mitigation                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec colours fail WCAG AA in some pairings (white on orange 2.28:1, `border` 1.58:1 for inputs, translucent focus ring 2.27:1, warning text on background 4.30:1) | Keep spec values; add derived tokens that pass and use them where the failing pairing would occur (ADR-004). The contrast contract test enforces it.     |
| NativeWind 5 (Tailwind v4) is still RC                                                                                                                            | Use stable NativeWind 4.2 (Tailwind v3) on mobile; generate its preset from the same tokens; parity test proves both outputs carry every token (ADR-003) |
| `@storybook/addon-vitest` does not support Vitest 5                                                                                                               | Run stories through axe with Vitest 5 browser mode + `composeStories` directly (ADR-003)                                                                 |
| Tailwind silently ignores unknown classes                                                                                                                         | Default palette/scales are removed from the theme, and the token guard test forbids arbitrary values and literals                                        |
| `'use client'` directives lost when bundling UI packages                                                                                                          | ui-web and ui-native ship TypeScript source (bundler-only consumers); only design-tokens is compiled                                                     |
| NativeWind 4 on Expo SDK 57 / RN 0.86 untested upstream                                                                                                           | Verified by Jest and by `expo export` bundling in CI                                                                                                     |

## Implementation notes (what changed versus the plan)

- **Extra derived tokens**: `on-scrim` (text on the destination scrim) and three layout sizes
  (`menu`, `popover`, `dialog`), because the spec spacing scale stops at 80px (ADR-003).
- **`tailwindMergeTheme`** lives in design-tokens so web and native class merging know the token
  names (otherwise `text-h2` and `text-primary` collide).
- **Traveller rules** landed in `@suskii/shared` with an exhaustive state walk test, ready for the
  phase 4 search schema.
- **Radix RadioGroup** (not ToggleGroup) backs the segmented control: single-choice semantics with
  arrow-key selection.
- **Fonts**: web uses `next/font/google` with `latin-ext` for the Naira sign and Yoruba/Igbo letters
  (build-time download, self-hosted output). Storybook uses `@fontsource-variable` offline.
- **Mobile test stack** (Jest 29, jest-expo, RNTL 14) was added to `apps/mobile` as well, with a
  home-screen smoke test; this also resolves expo-router's optional RNTL peer cleanly.
- **Pins**: `test-renderer` ~1.2 (1.3 needs React 19.3), `react-native-css-interop` 0.2.7 as a direct
  dependency (NativeWind's Babel transform imports it), Reanimated's Jest mock extended with
  `useReducedMotion`.
- **Visual check**: Storybook stories were screenshotted in Chromium at desktop and mobile widths;
  a date-range rounding bug found this way was fixed before commit.
