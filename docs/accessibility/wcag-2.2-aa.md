# WCAG 2.2 AA conformance

Target: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) level AA for the website (`apps/web`), the staff
console (`apps/admin`) and the app (`apps/mobile`, read through WCAG2ICT and EN 301 549 clause 11).
That is the level the European Accessibility Act (through EN 301 549) and the US ADA guidance
point to, and what airline and booking sites in those markets are held to (ADR-088).

This page says how each success criterion is met, what checks it in CI, and what still needs a
person. "Automated" means a test fails the build when the criterion breaks; "manual" means the
[screen reader checklist](../runbooks/screen-reader-checklist.md), run before each store release
and before releases that change search, checkout or sign-in.

Status as of 2026-10-28: every criterion is met in the automated checks below. The manual pass
on real iOS and Android devices has not been run yet (it needs the owner's devices and testers,
see "Open items").

## How it is checked

| Check                                                                                     | Where                                      | Runs                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| axe (WCAG 2.0 to 2.2 A and AA tags plus best practices) on every ui-web story, two widths | `packages/ui-web` Vitest browser tests     | CI, every push            |
| Contrast of every text and background pairing the tokens allow                            | `packages/design-tokens` contrast contract | CI                        |
| axe on every journey page and dialog the e2e suites reach                                 | `apps/web/e2e`, `apps/admin/e2e/a11y.spec` | CI (web and admin e2e)    |
| Sweep of every public page at 360 and 1280 px: axe, targets of 24 px or more              | `apps/web/e2e/a11y.spec.ts`                | CI (web e2e)              |
| Reflow at 320 px on every public page; text spacing at the criterion's values             | `apps/web/e2e/a11y.spec.ts`                | CI (web e2e)              |
| Search controls of 44 px or more (spec); a focus indicator on 40 tab stops                | `apps/web/e2e/a11y.spec.ts`                | CI (web e2e)              |
| The sticky header never hides focus; a flight search with the keyboard alone              | `apps/web/e2e/a11y.spec.ts`                | CI (web e2e)              |
| Hydration with other `Intl` data, right-to-left Arabic pages                              | `apps/web/e2e/hydration.spec.ts`, i18n e2e | CI                        |
| App source guard: roles, names, checked and selected states, input labels, font scaling   | `apps/mobile/src/accessibility.test.ts`    | CI (mobile Jest)          |
| App screens found by role and name (React Native Testing Library), Maestro journeys       | `apps/mobile/src/**/*.test.tsx`, `e2e/`    | CI (Jest; Maestro on PRs) |
| VoiceOver, TalkBack, NVDA, largest text size, screen curtain                              | `docs/runbooks/screen-reader-checklist.md` | Manual, before releases   |

## Success criteria

Web means the website and the console; App means the iOS and Android app.

### Perceivable

| Criterion                        | Level | How it is met                                                                                                                                                                                      | Checked by                       |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1.1.1 Non-text content           | A     | Icons are `aria-hidden` beside text or carry a label; photos have alt text from the catalog; card art is decorative. App icons sit in labelled touchables.                                         | axe; app guard; manual           |
| 1.2.1 to 1.2.5 Audio and video   | A, AA | Not applicable: no audio or video content.                                                                                                                                                         | -                                |
| 1.3.1 Info and relationships     | A     | Landmarks (`header`, `main`, `footer`, `nav`), one `h1` per page and ordered headings, labelled fields and fieldsets, tables with headers, lists as lists.                                         | axe (heading order, landmarks)   |
| 1.3.2 Meaningful sequence        | A     | DOM order is the visual order; right-to-left pages mirror with logical properties only, never by reordering.                                                                                       | axe; lint rule (logical classes) |
| 1.3.3 Sensory characteristics    | A     | Copy never relies on shape, colour or position ("the red button"); states have text.                                                                                                               | Review; manual                   |
| 1.3.4 Orientation                | AA    | Web: no orientation lock. App: follows the device (`orientation: 'default'`) since this audit.                                                                                                     | Config review                    |
| 1.3.5 Identify input purpose     | AA    | Personal fields carry `autocomplete` (`name`, `given-name`, `family-name`, `email`, `tel`, `street-address`, `current-password`, `new-password`, `one-time-code`); the app sets `textContentType`. | Review                           |
| 1.4.1 Use of colour              | A     | Status badges, errors, prices and fare changes carry text or an icon with a name, never colour alone.                                                                                              | axe (link-in-text); review       |
| 1.4.2 Audio control              | A     | Not applicable: nothing plays sound.                                                                                                                                                               | -                                |
| 1.4.3 Contrast (minimum)         | AA    | Colours come only from design tokens; every allowed pairing is at least 4.5:1 (3:1 for large text) by test; orange fills take dark text (ADR-004).                                                 | Contrast contract; axe           |
| 1.4.4 Resize text                | AA    | Web: text scales with browser zoom to 200% without loss (reflow below). App: system font size is honoured (`allowFontScaling` is never turned off).                                                | Reflow test; app guard; manual   |
| 1.4.5 Images of text             | AA    | No images of text; the logo is the only exception (allowed).                                                                                                                                       | Review                           |
| 1.4.10 Reflow                    | AA    | No horizontal scrolling at 320 CSS px on every public page; results and checkout stack to one column.                                                                                              | `a11y.spec` reflow               |
| 1.4.11 Non-text contrast         | AA    | Inputs use `border-strong` (3:1 or more), the focus ring token is 3:1 against both backgrounds, icons follow text tokens.                                                                          | Contrast contract                |
| 1.4.12 Text spacing              | AA    | Layouts use flexible heights; with the criterion's line, letter, word and paragraph spacing nothing overflows on the main pages.                                                                   | `a11y.spec` text spacing         |
| 1.4.13 Content on hover or focus | AA    | Popovers and menus open on press, stay until dismissed and close with Escape; tooltips are not used for information.                                                                               | ui-web stories (play + axe)      |

### Operable

| Criterion                        | Level | How it is met                                                                                                                                                                                                | Checked by                     |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| 2.1.1 Keyboard                   | A     | Every control is a native element or a Radix primitive; the date picker moves by arrow keys; a flight search is tested end to end with the keyboard.                                                         | `a11y.spec` keyboard journey   |
| 2.1.2 No keyboard trap           | A     | Dialogs trap focus only while open and return it to the opener on close (Escape closes).                                                                                                                     | ui-web stories; e2e            |
| 2.1.4 Character key shortcuts    | A     | Not applicable: no single-key shortcuts.                                                                                                                                                                     | -                              |
| 2.2.1 Timing adjustable          | A     | Search results last 30 minutes and then search again with the same request; supplier fare holds and payment deadlines are set by the airline or hotel (essential exception) and are shown before they start. | Review                         |
| 2.2.2 Pause, stop, hide          | A     | No carousels or auto-advancing content; spinners and skeletons stop under `prefers-reduced-motion`.                                                                                                          | Token test (reduced motion)    |
| 2.3.1 Three flashes              | A     | Nothing flashes.                                                                                                                                                                                             | Review                         |
| 2.4.1 Bypass blocks              | A     | "Skip to content" is the first link on every page and targets `main`.                                                                                                                                        | e2e                            |
| 2.4.2 Page titled                | A     | Every page sets a title through `pageMetadata`; in the app each screen opens with its heading (manual check).                                                                                                | e2e (`toHaveTitle`); manual    |
| 2.4.3 Focus order                | A     | DOM order; dialogs move focus in and back out; the date picker focuses the selected day.                                                                                                                     | `a11y.spec` keyboard           |
| 2.4.4 Link purpose (in context)  | A     | Card links name their destination ("Flights from Lagos to Accra"); "details" links carry the item in their name.                                                                                             | axe; manual                    |
| 2.4.5 Multiple ways              | AA    | Navigation, search, breadcrumbs on inner pages, the footer and the sitemap.                                                                                                                                  | Review                         |
| 2.4.6 Headings and labels        | AA    | Labels come from the message catalogs in every language; headings describe their sections.                                                                                                                   | axe; catalog tests             |
| 2.4.7 Focus visible              | AA    | `focus-visible:focus-ring` on every interactive element; a tested indicator on every homepage tab stop.                                                                                                      | `a11y.spec` focus              |
| 2.4.11 Focus not obscured (min.) | AA    | `scroll-padding-top` keeps focused elements below the sticky header (fixed in this audit); dialogs are modal.                                                                                                | `a11y.spec` sticky header      |
| 2.5.1 Pointer gestures           | A     | No path-based or multipoint gestures; ride pick-up and drop-off are typed or chosen from suggestions.                                                                                                        | Review                         |
| 2.5.2 Pointer cancellation       | A     | Actions fire on release (native buttons, `Pressable.onPress`).                                                                                                                                               | Review                         |
| 2.5.3 Label in name              | A     | Accessible names start with the visible label; icon buttons with a visible word use that word.                                                                                                               | axe (label-content-name)       |
| 2.5.4 Motion actuation           | A     | Not applicable: nothing responds to shaking or tilting.                                                                                                                                                      | -                              |
| 2.5.7 Dragging movements         | AA    | No dragging: dates, seats and filters are chosen by tapping.                                                                                                                                                 | Review                         |
| 2.5.8 Target size (minimum)      | AA    | Every target is at least 24 by 24 px except links inside sentences; search and checkout controls are 44 px or more (48 in the app, `min-h-12`).                                                              | `a11y.spec` targets; app tests |

### Understandable

| Criterion                                | Level | How it is met                                                                                                                                                         | Checked by                  |
| ---------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 3.1.1 Language of page                   | A     | `<html lang>` and `dir` follow the visitor's language (seven catalogs); the app follows the device.                                                                   | i18n e2e                    |
| 3.1.2 Language of parts                  | AA    | The language picker names each language in itself with its own `lang`; place and brand names are proper names (exempt).                                               | Review                      |
| 3.2.1 On focus                           | A     | Focus never submits, navigates or opens a new window.                                                                                                                 | Review; e2e                 |
| 3.2.2 On input                           | A     | Choosing an option changes only that field or filters results in place, announced through a status region; navigation needs a button.                                 | Review; e2e                 |
| 3.2.3 Consistent navigation              | AA    | One header and footer on every page.                                                                                                                                  | Layout                      |
| 3.2.4 Consistent identification          | AA    | Shared components and one catalog key per concept.                                                                                                                    | Review                      |
| 3.2.6 Consistent help                    | A     | Help and support sit in the same place in the header and footer on every page, and in Account in the app.                                                             | Layout                      |
| 3.3.1 Error identification               | A     | Field errors are text tied to the field (`aria-describedby`, `aria-invalid`); form errors use an alert role.                                                          | e2e; axe                    |
| 3.3.2 Labels or instructions             | A     | Every field has a visible label; formats (dates, passport) are stated.                                                                                                | axe                         |
| 3.3.3 Error suggestion                   | AA    | API validation issues map to the field with a message that says what to change.                                                                                       | e2e                         |
| 3.3.4 Error prevention (financial, data) | AA    | Checkout shows the full price before payment, a changed fare asks for consent, cancellations and refunds confirm, account deletion needs re-authentication.           | e2e (price consent, cancel) |
| 3.3.7 Redundant entry                    | A     | Saved travellers and the signed-in contact fill checkout; a search's places and dates carry to results and checkout.                                                  | e2e                         |
| 3.3.8 Accessible authentication (min.)   | AA    | Password managers and paste work (`autocomplete`, no paste blocking); Google, Apple and fingerprint sign-in; codes accept autofill; Turnstile has no puzzle to solve. | Review                      |

### Robust

| Criterion               | Level | How it is met                                                                                                                                                      | Checked by     |
| ----------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| 4.1.2 Name, role, value | A     | Native elements and Radix primitives on the web; in the app every touchable has a role and a name, radios and checkboxes report `checked`, tabs report `selected`. | axe; app guard |
| 4.1.3 Status messages   | AA    | Search progress, result counts, toasts and saved states use `role="status"`; errors use `role="alert"`.                                                            | axe; e2e       |

## Fixed in this audit

- The deals page skipped a heading level (cards were `h3` straight under the `h1`).
- The "watch this route" link and the sign-in and register helper links were 20 px tall.
- The sticky header could cover an element focused while tabbing backwards.
- Two radio groups in the app (support category, approval reason) announced "selected" instead of
  "checked".
- The app was locked to portrait.

## Open items

- The manual screen reader pass on iOS and Android, and with the largest text size: needs devices
  and testers (owner).
- A native speaker's review of the French, Swahili, Arabic and Portuguese labels (ADR-076) also
  covers how they are read aloud.
- Landscape layouts in the app were not checked on a device; the screens are single-column
  scroll views, and the Maestro journeys run in portrait.
- An accessibility statement page on the website (contact for problems and the date of the last
  review) needs the owner's support contact and legal text.
