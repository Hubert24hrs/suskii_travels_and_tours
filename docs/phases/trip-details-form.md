# One details form for the whole trip (ADR-118)

Outside the numbered phases. The owner's request of 2026-11-13, after ADR-117: one details form
for the whole trip, so a traveller whose trip Ask Suskii put together enters the contact and
everyone travelling once, books every part and pays once.

## Plan

| Part               | Where                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| The booking route  | `POST /v1/trips/{tripId}/book`: `trips.controller.ts`, `bookTripSchema` in `trips.schemas.ts`                      |
| Booking every part | `apps/api/src/trips/trip-booking.service.ts` (`BookingsService.create()` per part, then `TripsService.addPart()`)  |
| Errors             | `trip-nothing-prepared`, `trip-travellers-short` in `trip-errors.ts`; a part's problem carries `part`              |
| Cancelling again   | `BookingsService.cancel()` takes the reason `trip_booking_failed`                                                  |
| Who travels        | `tripPartFacts()`, `tripFacts()`, `arrivingFlight()` in `packages/shared/src/checkout-draft.ts`                    |
| Copy               | `trips.details` in the five catalogs; the `trip_handoff` note; `platform.guide`                                    |
| Website            | `apps/web/app/trips/[tripId]/details/page.tsx`, `components/trips/trip-details.tsx`, the button in `trip-view.tsx` |
| App                | `src/screens/trip-details-screen.tsx`, `app/trips/built/[tripId]/details.tsx`, the button on the trip screen       |
| Shared form code   | `components/checkout/booking-form.ts` (website), `src/lib/booking-form.ts` (app), used by both checkouts too       |

## Risks and how they are met

- **A half-booked trip.** All or nothing: what the request booked is cancelled again when a
  part refuses, seats and cars included, and nothing joins the trip before every part is booked.
- **A traveller's error shown on the wrong person.** The API moves each issue to the
  traveller's place in the form and names the part.
- **Booking twice after a lost answer.** One `Idempotency-Key` per body; a changed form is a new
  request, so a corrected traveller is not answered with the first refusal.
- **A second booking flow.** None: each part is the ordinary `createBooking` request, with its
  own checks, prices and re-check before payment.

## Outcome

Built on the API, the website and the app.

- API: `trip-booking.e2e-spec.ts` (four cases); the trips, bookings and agent suites still pass.
- App: three screen tests in `trip-builder.test.tsx`; the whole suite passes (54 suites, 372
  tests).
- Website: one e2e test in `trip-builder.spec.ts`, which answers the trip's prepared parts in
  the browser (only the assistant's summary writes them) and checks what the form sends.
- No phone flow: the phone check's stack cannot prepare parts without the assistant's model.

Open for the owner: whether bags and seats should move into the form (today they stay on the
flight's own checkout, which the trip page still opens).
