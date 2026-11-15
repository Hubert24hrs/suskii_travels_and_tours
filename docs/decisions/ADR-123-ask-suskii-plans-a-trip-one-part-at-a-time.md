# ADR-123: Ask Suskii plans a combined trip one part at a time, in an order kept in code

- Status: Accepted
- Date: 2026-11-15
- Deciders: the owner (asked for the flight options first, then the hotel, the car and the
  other services, each chosen in turn, then a checkout that takes the total), Claude Code
  (implementer)
- Amends: ADR-117 (the whole trip in Ask Suskii), ADR-109 (bookings prepared for the
  traveller), ADR-118 (one details form for the whole trip)

## Context

The owner's request, in their words: "for a combine trip planning, the flight options should
appear first, followed by hotel, car service and others. When the customer has chosen from his
flight options, then he/she should be brought to where he will choose hotel option, and then car
services options and others. After he/she is done choosing, he/she should be brought to a
checkout page where he/she should pay the total."

ADR-117 let the assistant prepare every part and sum them up, but the model set the order. After
a flight it offered the rest of the trip once (`alsoOffer`) and then waited to be asked. Three
things followed from that:

- Nothing made sure the next part's options were shown.
- The hotel search had to be asked for again, with places and dates the model typed out a second
  time.
- A choice such as "the second one" needed an id the model had to carry from one turn to the
  next. The conversation's history does not keep that id: it keeps words and answers, not tool
  results.

## Decision

1. **The order is set in the API, not in a prompt.** It is set by `AgentTripFlow`
   (`apps/api/src/agent/tools/trip-flow.ts`):
   - the flight;
   - then the parts in `TRIP_FLOW_PARTS`, in this order: a place to stay, a rental car, an
     airport transfer and travel insurance;
   - then the checkout.

   A conversation starts planning when the trip planner searches flights. When a part is
   prepared, its prepare tool asks `next()`. That runs the search for the next part and returns
   its options as `next`, in the same tool result. The answer that confirms a choice therefore
   also shows what to choose next.

2. **The trip's facts come from the prepared flight, never from a model.** A return flight to one
   place gives `tripFlowFacts`: the city, the local times of landing and of the flight back, and
   the travellers. From these facts:
   - **The stay:** check in on landing, check out on the day of the flight back, two adults to a
     room (`roomsFor`).
   - **A car:** collected an hour after landing, on the hour, and returned three hours before the
     flight back, on the hour (`rentalWindow`).
   - **A transfer:** on the day of landing. **Cover:** for the whole trip (`addonDays`).

   A one way flight has no trip to plan, so the checkout comes at once, with
   `trip_needs_return_date`.

3. **What the flow asks first, and what it passes over.**
   - **Children:** their ages are asked before a stay is searched, because a child's age changes
     the price and who counts as an adult. They are never assumed.
   - **A guest choosing a car:** asked to sign in (ADR-109).
   - **A part nothing is offered for** (no cars in the city, no cover for the country): passed
     over and named in `noneOffered`.
4. **Options are chosen by their number.**
   - **What is remembered:** each search tool remembers the options it showed in `AgentOptions`
     (`apps/api/src/agent/tools/agent-options.ts`). They are kept per conversation and kind
     (Redis `agent:options:{conversation}`), for 30 minutes (as long as a search's results), ten
     at most, ids only. Each prepare tool takes `option` (the number) beside the id.
   - **On screen:** an option's card carries `choose`. The website and the app draw a Choose
     button that sends, for example, "I choose option 2: Marina Suites" as the traveller's own
     message.
   - **Only the newest answer gets buttons:** an older list's number may name something no
     longer shown.
5. **Skipping a part.** `trips.next_part` passes over the part named in `skip` and returns the
   next one. It is a propose tool for the trip planner only. A part passed over is not shown
   again for this trip. A new flight for other days or another place forgets the parts chosen
   or passed over for the old trip, so nothing of it is paid with the new one.
6. **The checkout.** After the last part, `next` holds the summary of `trips.prepare_checkout`
   (ADR-117): each part with its price, and one total.
   - **A signed in traveller:** the parts go on one combined trip. Its card opens the trip's
     details form (`/trips/{id}/details`, ADR-118) while parts wait for details, which then leads
     to the one payment.
   - **A guest:** gets each part's own checkout and the `trip_sign_in` note.
7. **Routing stays with the planner until the checkout.** While a conversation is planning, the
   API says so in the run's context (`tripPlanning`), and the supervisor sends each message to
   the trip planner, because "option 2" or "no car" means nothing to another specialist. The
   keyword rules come first, so a question about a booking, a refund or a person still goes where
   it belongs.
8. **Prompts.** The trip planner's instructions (`FLOW`) give the order and how to read `next`.
   They say what to show, never a sentence to repeat (ADR-112). Prompt versions change: flights
   6, hotels 6, cars 5, tours 5, trip builder 7, disruption 4. New eval cases cover routing (r104
   to r106) and grounding (g18).

## Consequences

- **The order is tested in code.** `agent-tools.e2e-spec.ts` takes a signed in traveller from the
  flight to the checkout. It also takes a guest family, who are asked the children's ages and to
  sign in before a car.
- **Each choice runs the next part's search,** for four options. These are ordinary searches,
  through the same services, limits and caches.
- **An answer stays within its six cards:** the chosen part's card and at most four options.
- **What Redis holds is classified** in `docs/security/data-classification.md`: ids, places, local
  times and head counts, and nothing about a person.
- **The evals against the real model must run first.** As for every prompt change, the Cloud
  Build run comes before the new prompts answer travellers.
- **Older app builds draw the option cards without the button.** The traveller types the number
  instead, which works the same way.
- **Some products are not parts.** Tours, packages, visa assistance, eSIMs and lounge access are
  still not parts of a combined trip (ADR-117). The assistant can still prepare them on their
  own.

## Alternatives considered

- **The order in the prompt only:** what ADR-117 did. A model may skip a part, ask before it
  shows anything, or type the dates again.
- **One form with every part:** the trip pages already do that (ADR-099). The owner asked for
  the chat.
- **Ids in the conversation's history:** the history would hold tool results that the guard and
  the checkpoints do not keep, and a model would copy long ids.
