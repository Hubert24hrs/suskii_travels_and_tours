# Owner's changes, November 2026

Outside the numbered phases. The owner tried the test app on a phone and sent five reference
pictures with a list of changes. This page is the plan and, at the end, what was done. The
decisions are in ADR-108 (sign-in, "Remember me", search bars, stable city ids) and ADR-109
(Ask Suskii).

## What was asked

1. Sign in laid out like the first picture; fingerprint sign-in once an account exists;
   "Remember me" as in the picture.
2. After a hotel search and a visit to another section, the hotel form on Home did not work:
   fix it.
3. A bar to type into for the bus form's From and To.
4. The same for a ride's pick-up and drop-off.
5. Remove "Describe your trip" from the flight form.
6. One assistant for the whole platform, "Ask Suskii", on Google's Gemini 2.5 Flash: a button
   like the fifth picture that shows up in different places rather than staying in one, that
   answers questions, works with the agents already built, can book flights, hotels and car
   services for a traveller, asks about a hotel and a car after a flight, and knows the
   platform well.

The owner clarified item 6 on 2026-11-12: one button, not several at once; it should appear in
different places and never be seen in one place only.

## Plan

Two pull requests, in this order.

### Part 1: sign-in, search bars, the flight form, the hotel form (ADR-108)

| Area        | Files                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API         | `auth/session.service.ts`, `auth/cookies.ts`, `auth/auth.service.ts`, `auth/auth.controller.ts`, `auth/auth.schemas.ts`, a migration (`sessions.remembered`), `catalog/reference-ids.ts`, `prisma/seed.ts`                                                                                                                                                       |
| Shared      | `auth.ts` (`rememberSchema`)                                                                                                                                                                                                                                                                                                                                     |
| Website     | `components/account/auth-forms.tsx`, `social-sign-in.tsx`, `social-callback.tsx`, `auth-page.tsx`, `lib/social-sign-in.ts`, `components/search/*` (the box removed)                                                                                                                                                                                              |
| App         | `screens/auth-screens.tsx`, `components/auth/social-buttons.tsx`, `lib/session.ts`, `providers/auth.ts`, `providers/app-provider.tsx`, `components/booking/form-controls.tsx`, `screens/bus-search-screen.tsx`, `screens/ride-request-screen.tsx`, `components/search/hotel-search-form.tsx`, `screens/hotel-results-screen.tsx`, `lib/recent-hotel-searches.ts` |
| Components  | `ui-web` and `ui-native` `Input` (`trailing`)                                                                                                                                                                                                                                                                                                                    |
| Brand       | `brand/providers/*.svg`, `scripts/brand-assets.mjs`                                                                                                                                                                                                                                                                                                              |
| Catalogs    | every language: the card's strings, the search bars', "place not found"; the box's strings removed                                                                                                                                                                                                                                                               |
| Phone flows | `sign-in.yaml`, `cars-bus.yaml`, new `hotel-return.yaml`                                                                                                                                                                                                                                                                                                         |

Risks, and how each is met:

- **A box that does nothing.** "Remember me" changes the session's length on the server, the
  cookies' lifetime and what the app writes to the phone; each has a test.
- **Older app builds.** `remember` is optional and true when left out; no response changed.
- **A report that cannot be reproduced.** The hotel flow was written first and run on the
  emulator before any fix. It passed, so the fix is for the causes found by reading, and the
  page says what is still unknown.
- **Homepage JavaScript.** Removing the box removes a request and a lazy chunk; nothing is
  added to the homepage.
- **Provider marks.** Third-party colours stay out of components: the marks are image files.

### Part 2: Ask Suskii (ADR-109)

Built after part 1, with the owner's two later messages folded in: the button is one button
that moves (not several), and no customer reads a hyphen, a dash or wording that sounds machine
written.

Files:

- Agent service: `apps/agent/src/model/gemini-model.ts` (the adapter), `config.ts` and
  `factory.ts` (the provider and its default models), `prompts/prompts.ts` (version 3 of every
  customer specialist: preparing a booking, the one question after a flight, the platform
  guide, no dashes), `evals/cli.ts` (either provider), two new recorded safety cases.
- API: `src/agent/tools/checkout-tools.ts` (the three prepare tools), `platform-guide.ts` and
  `platform.guide`, ids on what the search tools return, two notes
  (`booking_handoff`, `other_services`), Gemini's price, Google as a recipient in the records
  of processing.
- Website: `components/assistant/ask-suskii.tsx` with its CSS in `app/globals.css`,
  `NoAskSuskii` on the pages that never show it.
- App: `components/assistant/ask-suskii-button.tsx`, `lib/ask-suskii.ts`, the card of a
  prepared booking opens the app's checkout.
- Copy: the five catalogs, the console's catalog, `format.dateRange`, the API's emails, texts
  and PDFs, with tests that keep hyphens and dashes out.

Risks taken and how they are bounded:

- **A model that says "booked".** The tool's status is always `not_booked` and the answer guard
  refuses the word; a graph test and two recorded safety cases cover it.
- **A button that passes over a control.** It rests 15 seconds, can be dragged or put away,
  and is never on a payment or sign-in screen. The website's whole end-to-end suite ran with
  it moving and nothing was blocked.
- **A new model nobody has measured.** Recorded evals prove the graph, the guard and the
  tools; the run against Gemini needs the owner's key.

## Outcome of part 1

Built and tested (results in the pull request). What the hotel report turned out to be:

- The phone flow passed on the emulator before any change: the steps as reported do not make
  the form ignore taps there.
- Two real defects were found and fixed: a city's id differed in every database (so a
  remembered search broke each time the test server was rebuilt, which happened while the
  owner was testing), and the hotel form came back empty after another tab was opened (so
  Search answered with an error).
- Not explained: a destination field that takes no typing. If it happens with the new test
  app, the steps and the phone's model are needed.
