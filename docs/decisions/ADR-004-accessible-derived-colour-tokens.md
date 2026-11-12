# ADR-004: Accessible derived colour tokens

- Status: Accepted
- Date: 2026-09-28
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec requires WCAG 2.2 AA and says derived shades must pass it, verified by an automated contrast
test. Measuring the spec palette (sRGB relative luminance, alpha composited over the real background):

| Pairing                                                         | Ratio       | WCAG minimum          | Result                    |
| --------------------------------------------------------------- | ----------- | --------------------- | ------------------------- |
| White text on `accent` `#F7941D` (orange buttons)               | 2.28:1      | 4.5 (3.0 large)       | Fails, at every text size |
| White text on `accent_hover` `#E0820F`                          | 2.85:1      | 4.5 (3.0 large)       | Fails, at every text size |
| `border` `#BFD0DC` as an input boundary on white                | 1.58:1      | 3.0 (1.4.11 non-text) | Fails                     |
| `focus_ring` `rgba(0,75,190,0.45)` over white                   | 2.27:1      | 3.0 (1.4.11 non-text) | Fails                     |
| `warning` `#B25E00` text on `background` `#F2F6F9`              | 4.30:1      | 4.5                   | Fails                     |
| Everything else in the palette (text, primary, status on white) | 4.5 to 18.3 | as applicable         | Passes                    |

The spec suggests "bold text at >= 16px" for white on orange. WCAG's large-text threshold is 18.66px
bold or 24px regular, and even large text needs 3:1, which white on this orange never reaches. So
that option cannot pass.

## Decision

Keep every spec colour exactly as given (a test asserts parity with `PROJECT_SPEC.json`) and add
**derived tokens** for the pairings that would fail. Components use the derived token wherever the
failing pairing would occur.

| Derived token    | Value                 | Used for                                                                  | Measured                                                      |
| ---------------- | --------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `on-primary`     | `#FFFFFF`             | Text/icons on primary fills                                               | 7.64 / 10.00 / 11.91 on primary / hover / pressed             |
| `on-accent`      | `#0D1520`             | Text/icons on orange fills (secondary buttons, promo badges)              | 8.04 on accent, 6.43 on accent hover                          |
| `on-status`      | `#FFFFFF`             | Text on solid success / warning / danger fills                            | 4.92 / 4.67 / 5.62                                            |
| `border-strong`  | `#7A8C9D`             | Boundaries of inputs and interactive controls                             | 3.46 on surface, 3.19 on background                           |
| `focus`          | `#004BBE` (= primary) | Solid 2px focus outline; the spec `focus_ring` stays as a soft outer halo | 7.64 / 7.03                                                   |
| `warning-text`   | `#A35600`             | Warning-coloured text                                                     | 5.40 surface, 4.97 background                                 |
| `primary-subtle` | `#E6EEFA`             | Info badge / selected-row tint (primary text on it)                       | 6.54                                                          |
| `scrim`          | `rgba(13,21,32,0.72)` | Dark bottom scrim on destination images                                   | 7.30 for `on-scrim` text over a pure white image (worst case) |
| `on-scrim`       | `#FFFFFF`             | Text on the scrim                                                         | see `scrim`                                                   |
| `overlay`        | `rgba(13,21,32,0.5)`  | Modal and sheet backdrop (decorative)                                     | n/a                                                           |
| `skeleton`       | `#E3EAF0`             | Loading placeholders (decorative, `aria-hidden`)                          | n/a                                                           |

`border` stays in use for decorative dividers and card outlines, where WCAG 1.4.11 does not apply.

Every pairing the components use is listed in `packages/design-tokens/src/contrast-contract.ts`.
The contrast test fails the build if any pairing drops below its minimum, so a future palette change
cannot silently regress accessibility.

## Consequences

- Orange CTAs ("Join Suskii Prime", "View deal") render dark text on orange. That is the only
  compliant option with this orange. A darker orange that takes white text would change the brand
  colour and is the owner's call.
- Inputs get a visibly darker border than the reference design.
- Focus is a crisp 2px blue outline plus the spec's translucent halo.

## Alternatives considered

- **Change the spec colours**: rejected. They are the owner's brand decision. Derived tokens satisfy
  the spec's own rule ("derived shades must pass").
- **White bold text on orange**: rejected. It fails at every size (see above).
