# ADR-088: WCAG 2.2 AA as the accessibility target, checked in CI

- Status: Accepted
- Date: 2026-10-28
- Item 12 of the standards plan agreed with the owner (US and European standards for African
  markets)

## Context

The European Accessibility Act applies to e-commerce and passenger transport booking services
sold to EU consumers from June 2025, through EN 301 549, which points to WCAG 2.1 AA today and
follows WCAG 2.2. US courts read the ADA against WCAG AA, and the US Department of
Transportation already requires airline websites and kiosks to meet it. Partners and company
accounts ask for it in procurement. Nigeria's Discrimination Against Persons with Disabilities
(Prohibition) Act 2018 points the same way. Accessibility built in now is cheap; retrofitted
after launch, across seven languages and three clients, it is not.

The platform already had axe on every ui-web story and on the e2e journeys, a tested contrast
contract, a skip link, `lang` and `dir`, logical properties for right-to-left pages, and a manual
screen reader checklist. It lacked a stated target, a sweep of every public page, checks for the
criteria axe cannot see (reflow, target size, focus visibility and obscuring, keyboard-only use,
text spacing) and any automated check in the app beyond role queries in screen tests.

## Decision

1. **Target WCAG 2.2 level AA** for the website, the console and the app (through WCAG2ICT and
   EN 301 549 clause 11). The conformance table lives in `docs/accessibility/wcag-2.2-aa.md` and
   changes with the code it describes.
2. **Automate what can be automated, in the suites that already run.** `apps/web/e2e/a11y.spec.ts`
   visits every public page at phone and desktop widths (axe with the WCAG 2.2 tags, targets of
   24 px or more except links inside sentences), reflow at 320 px, text spacing at the criterion's
   values, 44 px search controls (the spec's own rule), a focus indicator on every homepage tab
   stop, the sticky header never covering focus, and a flight search with the keyboard alone. A
   new public page goes in its `PAGES` list.
3. **A source guard for the app.** `apps/mobile/src/accessibility.test.ts` reads the app and
   ui-native sources and fails when a touchable has no role or no name, a radio, checkbox or
   switch does not report `checked`, a tab does not report `selected`, a text input has no label,
   or anything turns off font scaling. It is a static check, so it is fast and runs everywhere;
   behaviour stays with the screen tests and Maestro.
4. **The app follows the device's orientation.** A portrait lock fails 1.3.4 for people whose
   phone is mounted in landscape. The screens are single-column scroll views.
5. **People still check what machines cannot.** The screen reader checklist (VoiceOver, TalkBack,
   NVDA, the largest text size, screen curtain) runs before each store release and before any
   release that changes search, checkout or sign-in.

## Consequences

- The web e2e run is about two minutes longer.
- A new page, control or component that breaks a criterion fails CI rather than reaching
  travellers; the failure names the element.
- The target size check counts a stretched link (`after:absolute after:inset-0`) as the card it
  covers, and skips links inside a sentence (2.5.8's inline exception).
- Landscape layouts in the app are not covered by Maestro, which runs in portrait; the manual
  checklist covers them.
- Full conformance still needs the manual pass on real devices, which waits for the owner's
  testers and devices, and an accessibility statement with a contact, which waits for the
  owner's support contact and legal text.
