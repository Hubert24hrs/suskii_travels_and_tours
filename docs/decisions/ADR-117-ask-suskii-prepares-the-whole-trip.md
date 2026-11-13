# ADR-117: Ask Suskii prepares every product and puts the whole trip together

- Status: Accepted
- Date: 2026-11-13
- Deciders: the owner (asked for the assistant to check out every service: a flight, then a
  hotel there, a car and the other services, with one summary and one total), Claude Code
  (implementer)
- Amends: ADR-109 (bookings prepared for the traveller), ADR-099 (combined trips)

## Context

ADR-109 let Ask Suskii prepare a flight, a stay or a rental car: it quotes the option the
traveller chose and hands a card to the ordinary checkout. Everything else Suskii sells could
be found in the chat but not prepared. And each prepared part was its own checkout, paid on
its own, even when the traveller had just asked for a flight, the hotel there and a car.

The owner's request, in their words: when a customer says where they are going, after the
flight the assistant asks about a hotel there, shows options and prepares one if they want,
otherwise only the flight; it talks about cars and the other services; and it gives a summary
of everything the customer wants with the price added up for checkout.

Combined trips (ADR-099) already pay several bookings at once, but every part had to be chosen
again on the trip page.

## Decision

1. **Every product can be prepared.** Prepare tools join `flights`, `hotels` and `cars`:
   `packages.prepare_booking` and `tours.prepare_booking` (a departure the search listed, for
   the same travellers), `addons.prepare_booking` (an airport transfer, insurance, an eSIM or
   lounge access, for dates and travellers) and `visa.prepare_booking` (Suskii's assistance,
   for a nationality, a purpose and a travel day). Each quotes through
   `InhouseQuotesService.create()` as the grant's caller, as a tap on the product's page does,
   and hands a `/checkout/{quoteId}` card with the `booking_handoff` note; visa assistance also
   carries `visa_guidance`. The searches return the ids these tools take (`departureId` for
   up to four departures with room for the travellers, `addonId`, `productId`), which a model
   never shows.
2. **A bus trip stops at its seat map.** `buses.prepare_booking` checks the departure is still
   on sale with the seats asked for and hands a card to `/buses/trips/{id}` with the
   `choose_seats` note. It holds no seat and makes no quote: a bus quote needs a seat hold, and
   ADR-109 keeps the assistant from holding seats. The traveller picks the seats, enters the
   details and pays there.
3. **The conversation remembers what it prepared.** Each prepare tool notes its quote in
   `AgentPreparedParts` (Redis, `agent:prepared:{conversationId}`, six hours): the newest quote
   per kind of part, and the combined trip the conversation built or planned. Ids only,
   nothing about a person, written only for the grant's own conversation.
4. **One summary, one total.** `trips.prepare_checkout` (tier `propose`, scope `quotes`) reads
   those quotes again as the caller and answers with each part's price and one total, added up
   by the API in the conversation's currency. The model passes no ids, only the parts the
   traveller turned down (`leaveOut`). Parts whose quote ran out are named in `expired`.
5. **Paid once on a combined trip.** For a signed-in traveller with a prepared flight, the
   flight, the stay, the car, the transfer and the insurance go on a combined trip (ADR-099):
   the one the conversation already built while it is still the same trip and nothing on it is
   paid or being paid, otherwise a new one whose plan comes from the flight (its airports and
   days; back on the return flight, else on the day the stay, the car or the cover ends).
   `TripsService.prepare()` stores them on the trip as prepared parts (`trips.prepared`: the
   part, the quote, its title, its quoted price and when it expires). The trip page shows each
   with its price and "Enter details", which opens its ordinary checkout in trip mode; that
   checkout adds the booking to the trip (`addPart`, which drops the prepared entry), and the
   trip is paid once. The answer's card leads to the trip with the total; the notes are
   `trip_handoff` and, when there are parts a trip does not take, `trip_separate`.
6. **What a trip does not take keeps its own page.** Packages, tours, visa assistance, eSIMs
   and lounge access are not parts of a combined trip (ADR-099). The summary lists them with
   their price and their own checkout card, and counts them in the total.
7. **A guest gets the summary without the trip.** A combined trip needs an account, so a guest
   (and the assistant on WhatsApp, which never has an account scope) gets the parts, the total
   and each part's own card, with the `trip_sign_in` note.
8. **The conversation flows from part to part.** After a flight the assistant offers the rest
   once (ADR-109); after a stay it may ask about a car or a transfer; when the traveller has
   what they want, or asks for the total, the checkout or to pay, the specialist calls the
   summary. Specialists that prepare parts of a trip, the concierge and the payments
   specialist have it. Prompt versions: concierge 4, flights 5, hotels 4, cars 4, tours 4,
   trip_builder 5, payments 4.

The trip answer's new fields (`prepared`, `totalWithPrepared`) are optional, for app builds
already on phones. In the app, a card for a combined trip, a bus seat map, a package or a tour
opens the app's own screen.

## Consequences

- A traveller can say where they are going and leave with a flight, a stay, a car, a transfer
  and insurance on one trip with one total, entering each part's details and paying once.
- Nothing about who books, holds or pays changed: every part is still an ordinary booking made
  at its checkout, and the assistant still never takes a name, a document or money.
- A prepared part's price lasts as long as its quote (30 minutes for Suskii's own products, the
  supplier's offer for flights and hotels). A traveller who takes longer sees the part as not
  added on the trip page and chooses it again; the summary says which parts ran out.
- Each part still needs its own details form. One form for every part of a trip is not built.
- Refusals now pass on a reason beside their slug where the service gives one (`problemCodes`
  reads `{ code }`), so the assistant can say, for example, that a lounge is not sold there.
- The evals pass on recorded answers with three new safety cases (one per new note situation);
  the real-model run is the owner's (`infra/gcp/cloudbuild.agent-eval.yaml`, about 2 US
  dollars).

## Alternatives considered

- **One checkout page for every part.** Fewest steps for the traveller, but every product asks
  for different details (passports for a flight, a lead guest for a stay, a licence for a car),
  so it is a new form on the website and in the app and a new way to create several bookings
  at once. Kept as the next step if the owner wants it.
- **The model passes the quote ids to the summary.** Simpler, but a model would then carry ids
  between turns and could mix them up; the server's own record of what this conversation
  prepared cannot.
- **Tours, packages, visa assistance, eSIMs and lounges as parts of a trip.** ADR-099's open
  question. It changes the trip's plan, its page and its PDF in both clients; left for the
  owner to decide.
- **Holding bus seats from the chat.** Refused by ADR-109: a seat held by an assistant is a
  seat nobody else can buy while the traveller may never come.
