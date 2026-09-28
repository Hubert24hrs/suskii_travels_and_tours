# @suskii/design-tokens

The single source of truth for Suskii's visual design. `src/tokens.ts` holds the values from
`PROJECT_SPEC.json#/design_system/tokens` (a test asserts exact parity) plus the derived,
accessibility-driven tokens from [ADR-004](../../docs/decisions/ADR-004-accessible-derived-colour-tokens.md).

| Export                                  | Consumer                                                |
| --------------------------------------- | ------------------------------------------------------- |
| `@suskii/design-tokens`                 | Typed tokens, WCAG contrast utilities, generators       |
| `@suskii/design-tokens/theme.css`       | Tailwind v4 theme for web apps and `ui-web`             |
| `@suskii/design-tokens/tailwind-preset` | Tailwind v3 preset for NativeWind (`ui-native`, mobile) |
| `@suskii/design-tokens/tokens.css`      | Plain `--suskii-*` CSS variables                        |

Web usage (`globals.css`):

```css
@import 'tailwindcss';
@import '@suskii/design-tokens/theme.css';
```

## Guarantees (enforced by tests)

- **Spec parity**: every spec colour, size, radius, shadow, breakpoint and motion value is unchanged.
- **Contrast**: every pairing in `src/contrast-contract.ts` meets WCAG 2.2 AA. Add new pairings there.
- **Tokens only**: the web theme resets Tailwind's default palette and scales, and the native preset
  replaces them, so `bg-red-500`, `p-7`, `text-sm` and friends do not compile on either platform.
- **Parity**: the web theme and native preset generate the same token utilities.

Class names: colours `bg-primary`, `text-foreground`, `text-muted`, `text-heading`,
`border-border-strong`; type `text-hero`, `text-h2`, `text-body`, `text-body-sm`, `text-caption`;
spacing `p-4` (16px) on the 4px scale; radii `rounded-sm|md|lg|xl|pill`; shadows
`shadow-primary-button`, `shadow-card-hover`; motion `duration-fast`, `ease-standard`; focus
`focus-visible:focus-ring`.
