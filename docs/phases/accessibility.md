# Accessibility audit (WCAG 2.2 AA)

Item 12 of the roadmap agreed with the owner (US and European standards for African markets):
audit the website, the console and the app against WCAG 2.2 AA, fix what fails, and make CI keep
it that way (ADR-088).

## Why

The European Accessibility Act covers booking services sold to EU consumers, US airline sites
must meet WCAG AA, and partners and company accounts ask for it. About one person in six lives
with a disability; a traveller who cannot complete checkout with a screen reader or with large
text is a lost booking.

## Where the platform stood

- axe on every ui-web story at two widths, and on the web and console journeys in e2e.
- A contrast contract for every token pairing, focus ring and input border tokens (ADR-004).
- Skip link, `lang` and `dir`, logical properties for Arabic, reduced motion for spinners.
- A manual screen reader checklist (`docs/runbooks/screen-reader-checklist.md`).
- Missing: a stated target and conformance table, a sweep of every public page, checks for what
  axe cannot judge, and automated checks in the app.

## Plan

| Step | Work                                                                                                                                                          | Files                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1    | Web sweep: every public page at 360 and 1280 px with axe and a 24 px target check; reflow at 320 px; 44 px search controls; focus indicators; keyboard search | `apps/web/e2e/a11y.spec.ts`             |
| 2    | Fix what the sweep finds                                                                                                                                      | `apps/web`                              |
| 3    | App: survey touchables, inputs and font scaling; a source guard test; fix what it finds                                                                       | `apps/mobile`, `packages/ui-native`     |
| 4    | Criteria axe cannot see: focus not obscured by the sticky header, text spacing, orientation                                                                   | `apps/web`, `apps/mobile/app.config.ts` |
| 5    | Conformance table, ADR-088, CHANGELOG and CLAUDE.md                                                                                                           | `docs`                                  |

## Risks

- **False confidence.** Automated checks find roughly a third to a half of real problems. The
  manual checklist stays mandatory before releases, and the table says which criteria rely on it.
- **Slower CI.** The sweep adds about two minutes to the web e2e job.
- **Landscape in the app.** Allowing rotation could expose layouts that were only ever seen in
  portrait; screens are single-column scroll views, and the manual pass covers landscape.

## Outcome

Built as planned (ADR-088):

- **Web sweep:** 72 tests in `a11y.spec.ts`, all passing locally against the built stack: axe and
  target sizes on 21 pages at two widths (42), reflow at 320 px (21), text spacing on five key
  pages, the 44 px search controls, focus indicators on 40 tab stops, the sticky header never
  hiding focus, and a flight search with the keyboard alone.
- **Fixed on the web:** the deals page skipped a heading level; the "watch this route" link and
  the sign-in and register helper links were 20 px tall; the sticky header could cover an element
  focused while tabbing backwards (`scroll-padding-top` on `html`).
- **App:** a source guard (`accessibility.test.ts`, 3 tests) over every touchable (32) and every
  text input; two radio groups announced "selected" instead of "checked" (support category,
  approval reason); the app now follows the device's orientation instead of locking to portrait.
- **Docs:** `docs/accessibility/wcag-2.2-aa.md` (all 55 A and AA criteria: how each is met and
  what checks it), ADR-088.

Waiting for the owner: the manual screen reader pass on iOS and Android devices, an accessibility
statement page (support contact and legal text), and the native speakers' review of the four
newer languages (ADR-076).
