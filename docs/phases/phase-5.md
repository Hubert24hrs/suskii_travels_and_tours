# Phase 5: Flight and hotel booking flow (web)

Status: done, awaiting review

## Goal

Take a traveller from search results to a confirmed booking on the web: flight and hotel results
with filters, sorting and fare details; a checkout with passenger details, saved travellers,
extra baggage, a promo code, terms consent and a price re-check right before payment; an explicit,
audited booking state machine; a mock payment that completes through a signed webhook; and a
confirmation page, e-ticket or hotel voucher PDF and confirmation email.

## Acceptance criteria (from PROJECT_SPEC.json)

1. A full search-to-confirmation Playwright test passes with mock payment.
2. The price-change re-consent path is tested.
3. State machine transitions are 100% unit-tested.

## Scope decisions

- **Payments are mocked in this phase.** A `PaymentProvider` interface with a `MockPaymentProvider`
  (hosted checkout page on the web app, HMAC-signed webhook) exercises the real flow: webhook as the
  source of truth, deduplicated events, server-side amount verification. Paystack, Flutterwave and
  Stripe adapters, installments, holds, refunds and the ledger are phase 6 (ADR-014).
- **Supplier ancillaries**: extra checked baggage where the supplier offers it (the mock does).
  Seat maps come with a real supplier that supports them. Travel add-ons (insurance, transfers,
  eSIM, lounge) are phase 8.
- **Accounts on the web** (sign-in pages, trips) are phase 9. The API supports signed-in and guest
  checkout now; guests get a one-time booking access token for the confirmation page. Saved
  travellers have full API support; the checkout offers them when the browser has a session.
- **Ticketing failures** are retried by the worker with backoff; when the retry budget runs out the
  booking moves to `REFUND_PENDING` and operations are alerted through the audit log. The refund
  itself is executed in phase 6.
- **Hotel map view** is left out (maps are optional in the spec); results are a list.

## Plan

### Shared (`packages/shared`)

- Passenger and contact schemas: title, given names and surname as printed in the passport's
  machine-readable zone (Latin letters, spaces, hyphens, apostrophes; length limits), date of
  birth, gender, nationality, passport number, issuing country and expiry. Transliteration of
  accented Latin names (`Adébáyọ̀` to `ADEBAYO`); other scripts are rejected with guidance.
- Age rules against the itinerary: adults 12+, children 2-11, infants under 2 **on the last travel
  date**; passport expiring within 6 months of the last travel date is a warning.
- Hotel guest schema (lead guest per room), booking statuses, and a versioned
  `BOOKING_TERMS_VERSION`.

### API (`apps/api`)

- **Migration 4**: `bookings` (short reference, status, owner or guest token hash, encrypted
  contact, price snapshot, pending re-price, terms consent, deadlines), `booking_items`
  (offer snapshot, supplier reference, ticket numbers, services), `booking_passengers` (encrypted
  passport number), `booking_status_history`, `travellers` (saved passengers, encrypted passport),
  `payments`, `webhook_events` (unique per provider event id), `booking_documents`.
- **State machine** (`bookings/booking-state-machine.ts`): the spec's 13 states, a transition
  table keyed by event, every transition persisted to `booking_status_history` and the audit log in
  the same transaction. A table-driven test covers every state x event pair.
- **Suppliers**: `book()` on `FlightSupplier` (with extra baggage services) and `HotelSupplier`,
  idempotent by booking item id so a retry never double-issues. Mock implementations are
  deterministic; `MOCK_REPRICE_RULES` (mock only) makes chosen routes change price on re-pricing
  for tests. Duffel implements booking through its orders API.
- **Quotes**: `GET /v1/quotes/{quoteId}` for the checkout page; quotes keep the original search so
  an expired offer can send the traveller back to the same search.
- **Bookings**:
  - `POST /v1/bookings` (idempotent, guest or signed in, Turnstile for guests): validates the quote,
    passengers against the offer and itinerary, services and promo code; prices the booking;
    returns it with a guest access token.
  - `GET /v1/bookings/{bookingId}`: owner or `X-Booking-Token`; others get 404.
  - `POST /v1/bookings/{bookingId}/payments` (idempotent): re-prices with the supplier; a changed
    price answers 409 with the difference and waits for consent; otherwise creates a payment and
    returns the hosted checkout URL.
  - `POST /v1/bookings/{bookingId}/price-consent` and `/cancel`.
  - `GET /v1/bookings/{bookingId}/documents/{documentId}`: the PDF, same access rules.
- **Payments**: `PaymentProvider` + `MockPaymentProvider`; `POST /v1/payments/webhooks/{provider}`
  (raw body, signature, dedupe, amount check); mock checkout endpoints for the web page. A
  successful payment moves the booking to `PAID`, records the promo redemption and starts
  ticketing.
- **Ticketing and documents**: supplier booking, then `CONFIRMED`; e-ticket and voucher PDFs
  (pdf-lib, QR code of the reference) stored through an `ObjectStorage` interface (filesystem
  adapter locally, refused in production like other mocks); confirmation email with the PDF
  attached.
- **Saved travellers**: `GET/POST /v1/me/travellers`, `PUT/DELETE /v1/me/travellers/{id}`;
  passport numbers encrypted with a record-bound context and returned masked.
- **Internal routes** for the worker: bookings due for ticketing retries, retry one, expire
  unpaid bookings past their deadline.
- **Results**: flight filters gain maximum duration and checked baggage; hotel filters gain
  minimum rating and area.

### Worker (`apps/worker`)

A bookings scheduler (every minute): ticketing retries with exponential backoff and booking
expiry, both through the internal API.

### Web (`apps/web`)

- **Flight results** (`/flights/search`): search from the URL, offer cards (times with +1 days,
  stops, duration, carrier, baggage, refundable), filters from facets (stops, airlines, departure
  times, price, duration, baggage, refundable), sort (best, cheapest, fastest), fare details
  (segments, layover warnings, baggage, change and refund conditions), load more, expired-results
  recovery. Filters and sort live in the URL.
- **Hotel results** (`/hotels/search`) with filters (price, stars, rating, free cancellation,
  amenities, area) and sort, and a **hotel page** with rates, board, cancellation policy, taxes
  and pay-at-property charges.
- **Checkout** (`/checkout/{quoteId}`): trip summary, passengers (saved travellers when signed in),
  contact, extra bags, promo code, terms consent, Turnstile for guests, price re-check with a
  consent dialog, expired-offer recovery.
- **Mock payment page** (`/checkout/mock-payment/{reference}`, only when the API uses the mock).
- **Booking page** (`/bookings/{bookingId}`): polls until confirmed, shows the itinerary or stay,
  passengers, price paid and document downloads.

## Tests

- Unit: the state machine (every state x event), passenger rules and transliteration, pricing of
  services, mock payment signatures, PDF generation, Duffel order mapping, worker processors.
- API e2e: full flow over HTTP, price change and consent, expired offer, validation, ownership (404
  for others), idempotent replays, webhook signature, duplicate and amount-mismatch events,
  documents access, saved travellers encryption, ticketing retries and exhaustion, expiry.
- Playwright: flight search to confirmation with mock payment, price-change consent, hotel search
  to voucher, results filters and sort, axe on results, checkout and booking pages.

## Risks and mitigations

| Risk                                                    | Mitigation                                                                                      |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Double charge or double ticket on retries               | Idempotency keys on booking and payment writes, webhook dedupe, supplier booking keyed by item  |
| Paying a stale price                                    | Re-price immediately before creating the payment; explicit consent on any change                |
| Leaking passenger data                                  | Encrypted passport numbers and contact details, masked in responses, never logged               |
| Guests losing access after closing the tab              | Confirmation email with reference and documents; booking lookup arrives with accounts (phase 9) |
| Mock payment reaching production                        | Mock adapters refused in production unless explicitly allowed (existing guard)                  |
| Results and checkout bundles creeping onto the homepage | Route-level code splitting; the homepage budget test keeps running                              |

## Outcome

All three acceptance criteria are met:

1. `apps/web/e2e/booking.spec.ts` walks a flight from results through checkout and the mock
   payment to a confirmed, ticketed booking with its e-ticket, and a hotel stay to its voucher.
2. The same spec and `apps/api/test/bookings.e2e-spec.ts` cover the price-change consent path
   (409 with the difference, consent, payment at the new total).
3. `booking-state-machine.spec.ts` checks every state x event pair (182).

### Deviations from the plan

- Saved travellers are replaced with `PUT` rather than patched: the form always sends the whole
  traveller, and a document without a number keeps the stored passport number.
- `MOCK_REPRICE_RULES` apply on an offer's second re-price (the check before payment), so the
  consent path is deterministic and a consented price does not move again.
- Stored idempotent responses are encrypted, because a replayed booking creation returns the guest
  access token.
- Flight filters for journey time and checked baggage already existed from phase 3; hotels gained
  the area filter and facet.
- The worker's ticketing sweep is bounded: the API starts no new attempt after 20 seconds and the
  rest wait for the next minute.
