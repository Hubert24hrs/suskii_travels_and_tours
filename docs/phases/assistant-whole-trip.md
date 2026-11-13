# Ask Suskii: every product, and the whole trip with one total (ADR-117)

Outside the numbered phases. The owner's request of 2026-11-13: build the package, tour and bus
checkouts in the assistant first, then let it check out every service: after the flight it asks
about a hotel at the destination, shows options and prepares one if the traveller wants
(otherwise only the flight), talks about cars and the other services, and gives a summary of
everything wanted with the price added up for checkout.

## Plan

| Part                         | Where                                                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Ids in the searches          | `apps/api/src/agent/tools/product-tools.ts`                                                                     |
| Prepare tools                | `apps/api/src/agent/tools/checkout-tools.ts`                                                                    |
| What a conversation prepared | `apps/api/src/agent/tools/prepared-parts.ts` (Redis, ids only)                                                  |
| The summary tool             | `apps/api/src/agent/tools/trip-checkout-tools.ts`                                                               |
| Prepared parts on a trip     | `trips.prepared` (migration `20261129120000_trip_prepared_parts`), `TripsService.prepare()`, the trip answer    |
| Notes                        | `choose_seats`, `trip_handoff`, `trip_sign_in`, `trip_separate` in `@suskii/shared`, five catalogs and WhatsApp |
| Website                      | `apps/web/components/trips/trip-view.tsx`                                                                       |
| App                          | `apps/mobile/src/screens/built-trip-screen.tsx`, `src/lib/assistant.ts`                                         |
| Prompts                      | `apps/agent/src/prompts/prompts.ts` (`SUMMARY`, the cars and tours tasks)                                       |
| Guide                        | `apps/api/src/agent/platform-guide.ts`                                                                          |

## Risks and how they are met

- **A model mixing up ids between turns.** The summary takes no ids: the prepare tools note
  their quotes for the conversation, and the summary reads them back as the caller.
- **A total a model made up.** The API adds the prices up; the guard holds a figure that no
  tool returned.
- **Seats held by an assistant.** A bus trip stops at its seat map; nothing is held (ADR-109).
- **A trip charged for parts the traveller did not book.** A prepared part is a quote on the
  trip page, never in the payment: it joins the trip only when its checkout creates the
  booking, and the payment covers bookings only.
- **Older app builds.** The trip answer's new fields are optional; an old build shows the trip
  as before.
- **Quotes running out.** Prepared parts show only while their quote lives; the summary names
  the parts that ran out so the assistant can prepare them again.

## Outcome

Built and tested:

- API end to end (`agent-tools.e2e-spec.ts`, 21 cases): every new prepare tool, the bus seat
  map with no seat held, the whole trip for a signed-in traveller (one trip, the parts on its
  page, one total, a part booked from the trip page, a part turned down) and the guest's
  summary; the trips, agent service, chat, WhatsApp, gateway and accounts suites; the unit
  tests.
- Agent service: prompt tests (the summary and the seat map handover pass the leak guard) and
  the three evals on recorded answers, with three new safety cases.
- App: the trip screen with a prepared part, and the cards that open the app's own screens.
- Catalog tests for the new strings in every language.

Not done here:

- The evals against the real model: the owner runs `infra/gcp/cloudbuild.agent-eval.yaml` on
  Cloud Build (no key, about 2 US dollars) before the new prompts answer travellers.
- One details form for every part of a trip, and tours, packages, visa assistance, eSIMs and
  lounges as parts of a combined trip: both are the owner's to decide (ADR-117, Alternatives).
