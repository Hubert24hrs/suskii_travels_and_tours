# ADR-120: The receipt of a combined trip, and the whole trip run end to end

- Status: Accepted
- Date: 2026-11-14
- Deciders: the owner (asked to see a customer book a flight from Lagos to London, a hotel and a
  car, pay for everything and then find the receipt in their profile, on the website and in the
  app, with every part of the platform running), Claude Code (implementer)
- Amends: ADR-099 (combined trips), ADR-117 (Ask Suskii prepares the whole trip), ADR-002
  (version pins)

## Context

Mapping that journey across the platform found one gap and one untested link.

**No receipt for the one payment.** Each part of a combined trip has the document of its own
booking: the flight's e-ticket (a PDF titled "Ticket receipt"), the stay's voucher, nothing for a
rental car. The trip's only PDF was its plan, which says "A plan, not a booking", rightly, since it
is meant for before payment. A traveller who paid once for three parts had nothing that showed
that payment. The account's Trips page listed bookings only, so the combined trip was not in the
profile at all; the app's Trips tab did not list it either.

**The assistant's chain was tested in pieces.** The tools ran against the real API through the
gateway (`agent-tools.e2e-spec.ts`), the LangGraph graph ran with a fake gateway (its tests and
the recorded evals), and the service ran over HTTP with the sample model, which only reads the
status page (`agent-service.e2e-spec.ts`). No test had the graph prepare a trip through the real
gateway, so nothing proved the pieces fit for the journey the owner described.

## Decision

1. **A receipt for a paid combined trip** (`GET /v1/trips/{tripId}/receipt`, a PDF). It prints:
   - the trip's reference and when the receipt was written;
   - each payment that went through: when, the amount, the method's kind ("Card", "Bank
     transfer") and Suskii's reference for it as the provider knows it, plus "Refund started" for
     any amount no part could take (refunded automatically, ADR-099);
   - the trip: route, dates and travellers;
   - each part that kept its share: what it is, its booking reference, the share paid and the
     service taxes stored on the booking (ADR-072);
   - the total paid.

   It ends by saying that each part's tickets or vouchers, its conditions and any later refund are
   on its booking page. It shows no name, contact or card detail. It is drawn from the records
   when asked for and never stored. Only the trip's owner can read it (404 for anyone else), and
   it answers 409 `trip-not-paid` until a payment has gone through and a part took it. A payment
   for the wrong amount is refunded in full (ADR-099) and gives no receipt.

   The same receipt is also data (`GET /v1/trips/{tripId}/receipt/details`, added on
   2026-11-15), for a client to show in its own words. One function (`tripReceipt()`) decides
   what both say, so the screen and the PDF cannot disagree.

2. **The trip answer says when the receipt is ready**: `receipt: { paidAt, amount }`, null before.
   The field is optional, for older app builds.
3. **Where the traveller finds it**:
   - On the website, the trip page shows a Receipt card under "Your trip is paid" with when and
     how much, and saves the PDF. The account's Trips page lists the combined trips first, each
     opening its trip and saving its receipt, then every booking.
   - In the app, the trip screen shows the same card under the parts, so a paid trip still
     opens on each part's state. The card opens the whole receipt on a screen of its own, from
     the receipt's data, and hands the PDF to the share sheet, deleting its copy when the sheet
     closes. A share sheet alone was not enough: on most Android phones it offers apps to send
     the file to, not one to read it in. The Trips tab lists the combined trips first while
     the API answers; they are not kept offline.
4. **A moment kept on record names its year**: `format.dateTime(instant, zone, { year: true })`
   for the payment on a receipt. Deadlines keep the short form.
5. **The whole trip through Ask Suskii, end to end** (`apps/api/test/agent-whole-trip.e2e-spec.ts`).
   The agent service runs as its own process with a scripted stand-in model
   (`apps/agent/src/test/scripted-service.ts`, script `whole-trip`). The script reads the days from
   the traveller's words and every id from what the tools really returned. Everything else is the
   shipped service and API:
   - the router chooses the trip builder;
   - eight tool calls go through the gateway with the run's sealed grant: flights, places, the
     flight prepared, stays, rental cars, the stay and the car prepared, and the sum of the trip;
   - the guard checks the answer, and checkpoints are kept in Postgres;
   - then the details form, one payment, every part confirmed, and the receipt.

   `main.ts` and the test entrypoint start the same `runAgentService()`. The build leaves
   `src/test` out of the image, and the entrypoint refuses to start in production.

6. **`pg` stays on major 8.** Prisma's driver adapter can overlap the queries of one transaction,
   which pg 8 queues with a deprecation warning and pg 9 will refuse. Dependabot ignores pg majors
   until the adapter waits for each query (ADR-002).

## Consequences

- A traveller who pays a combined trip once gets one document for that payment, beside each
  part's own ticket or voucher. The profile on both clients lists the trip, so the receipt is
  found where the bookings are.
- The receipt is a record, not a promise: it states what was paid and what each part took, and
  sends the reader to the booking page for anything that changes later (a cancellation, a
  refund).
- The scripted model proves the wiring, not a model's choices. The evals against Gemini on
  Vertex AI (Cloud Build, ADR-112) remain the check of the prompts before they answer travellers.
- The receipt shows the payment reference. That is Suskii's own payment id, which Paystack
  uses as the transaction reference (ADR-119) and support uses to find a payment. It is not card
  data or a credential.

## Alternatives considered

- **The parts' documents only.** None of them shows the one payment, and a rental car has no
  document at all.
- **Calling the plan PDF a receipt once the trip is paid.** The plan says what a trip would
  cost; a receipt says what was paid. One document changing its meaning with the trip's state
  would be read wrongly by someone holding an old copy.
- **Storing the receipt as a file.** The records hold everything it prints. A stored file would
  need its own retention and could disagree with the records after a refund.
- **Scripting the assistant inside the API** (`AGENT_SERVICE=mock`). That skips the agent
  service, LangGraph and the gateway, which are what the test is about.
