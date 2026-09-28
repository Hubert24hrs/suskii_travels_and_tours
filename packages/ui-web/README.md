# @suskii/ui-web

Accessible React components for the website and admin console, styled only with
`@suskii/design-tokens` utilities (Tailwind v4). Shipped as TypeScript source: Next.js and Storybook
bundle it, which keeps `'use client'` boundaries intact.

| Component                         | Built on                         | Notes                                                                         |
| --------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| Button                            | native `<button>` / Radix Slot   | primary, secondary (orange, dark text), ghost; `loading`; `asChild` for links |
| Input                             | `<input>`                        | required label, hint, error (`aria-invalid` + description), icon slot         |
| Tabs                              | Radix Tabs                       | icon + label, 3px active underline, horizontally scrollable                   |
| SegmentedControl                  | Radix RadioGroup                 | trip type pills; arrow keys move the selection                                |
| Combobox                          | downshift `useCombobox`          | WAI-ARIA 1.2 combobox; loading/empty in a live region                         |
| DateRangePicker                   | DayPicker + Radix Popover/Dialog | two months in a popover (desktop), full-screen dialog (mobile)                |
| PassengerPicker                   | Radix Popover/Dialog             | shared traveller rules from `@suskii/shared`                                  |
| Card, DealCard, DestinationCard   | —                                | cards take a `linkComponent` (e.g. `next/link`)                               |
| Badge, TrustBar, Skeleton         | —                                | TrustBar renders only the (verified) items it is given                        |
| Dialog (modal, sheet, fullscreen) | Radix Dialog                     | focus trap and restore, required title                                        |
| Toast                             | Radix Toast                      | `ToastProvider` + `useToast()`                                                |

Components contain **no user-facing copy**: every label is a prop, so apps pass localised strings.

## Use in a Next.js app

```css
/* app/globals.css */
@import 'tailwindcss';
@import '@suskii/design-tokens/theme.css';
@source '../node_modules/@suskii/ui-web/src';
```

Add `transpilePackages: ['@suskii/ui-web']` to `next.config.ts`.

## Develop

```powershell
pnpm --filter @suskii/ui-web dev          # Storybook on http://localhost:6006
pnpm --filter @suskii/ui-web test         # browser tests (Chromium via Playwright)
pnpm --filter @suskii/ui-web build:storybook
```

Tests run every story through axe (WCAG 2.2 A/AA, real browser, including colour contrast) at 360px
and 1280px, run keyboard interaction tests, and fail on hardcoded colours, lengths or arbitrary
Tailwind values in component source. First run: `pnpm --filter @suskii/ui-web exec playwright install chromium`
(or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium).
