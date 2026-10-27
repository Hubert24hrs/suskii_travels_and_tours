# ADR-068: Brand refresh from the SUSKII T&T logo

- Status: Accepted
- Date: 2026-10-27
- Deciders: Owner (logo, name), Claude Code (implementer)

## Context

The owner supplied the logo (`brand/suskii-tt-logo.webp`) and asked for three things:

- the platform redesigned in its colours;
- the app shown as "SUSKII T&T" under its icon;
- the logo as the app icon.

The logo is a red-to-orange rounded square with white S-arrows, an orange shopping-cart tile, the
name in royal blue and the tagline in gold. The design system was blue and orange. Its colours
come from `PROJECT_SPEC.json` (a parity test keeps `tokens.ts` identical), and every text and
control pairing must pass WCAG 2.2 AA (the contrast contract).

## Decision

### Colours

| Token                                        | Before                | After                 | From the logo                                   |
| -------------------------------------------- | --------------------- | --------------------- | ----------------------------------------------- |
| `primary` (buttons, links, focus of actions) | `#004BBE`             | `#D11F0E`             | the red, darkened to 5.4:1 with white           |
| `primary-hover` / `-pressed`                 | `#003C98` / `#00327F` | `#B01A0C` / `#93160A` | darker reds                                     |
| `heading`                                    | `#004BBE`             | `#0B3FBF`             | the name's blue (8.5:1 on white)                |
| `accent` / `-hover`                          | `#F7941D` / `#E0820F` | `#F7A21B` / `#E68D0A` | the cart tile's orange, with dark text          |
| `background`                                 | `#F2F6F9`             | `#FFF8F6`             | a warm white                                    |
| `border` / `border-strong`                   | `#BFD0DC` / `#7A8C9D` | `#EAD9D4` / `#857773` | warm greys (`border-strong` 4.3:1)              |
| `danger`                                     | `#C62828`             | `#B3261E`             | a deeper crimson, so errors differ from actions |
| `focus` / `focus-ring`                       | blue                  | the logo's blue       | a blue ring stays visible on red buttons        |

- **The brightest red that passes.** The logo's own red, `#F0190A`, gives 4.3:1 with white, below
  4.5:1. `#D11F0E` is the brightest close red that passes on both white and the background.
- **The tagline's gold** fails as text on white (2.5:1), so it is not a text token.
- **Checks.** `PROJECT_SPEC.json` and `tokens.ts` change together. Every pairing passes
  `contrast-contract.ts`, and the ui-web axe tests and visual baselines are refreshed.

### Name and assets

- **Name.** `BRAND.shortName` is `SUSKII T&T`. It appears in the website and app headers, page
  titles and the web manifest. The legal name (`BRAND.name`) is unchanged. The app is named
  `SUSKII T&T` in production and in the test build, and `SUSKII T&T (<variant>)` otherwise.
- **Images.** `scripts/brand-assets.mjs` builds every image from the one source, using the
  `sharp` that ships with Next.js. It trims the logo's dark rim and makes its corners transparent
  for marks, or the logo red for opaque icons, which the platforms round themselves. It writes:
  - the app icon and the Android adaptive icon (the logo at 80% inside the safe zone, on the
    primary red);
  - the splash (the logo on white) and the Home screen logo;
  - the website and console `icon.png` and `apple-icon.png`, which replace the old "S" icons;
  - the header mark.
- **Headers.** The website header shows the mark next to the name in the logo's blue. The app's
  Home shows the logo, the name and the tagline.

## Consequences

- **Visual change.** Every screen picks up the new colours through the tokens; no component
  hard-codes them.
- **Owner checks.** The owner should confirm the derived shades. A vector logo would give sharper
  small icons than the 1254 px raster.
- **Splash backgrounds.** The adaptive icon's background is the primary token, close to the logo's
  lower edge. The top-left of the logo is orange, so its rounded square shows against the red on
  launchers that mask to a circle.
