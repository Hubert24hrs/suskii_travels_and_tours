# Ask Suskii: a combined trip planned one part at a time (ADR-123)

Outside the numbered phases. The owner's request of 2026-11-15: when a combined trip is planned
in the chat, the flight options come first. Once a flight is chosen, the traveller is brought to
the hotel options, then the car options, then the other services. When they are done choosing,
they are brought to a checkout where they pay the total.

## Plan

| Part                             | Where                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------- |
| The order and the trip's facts   | `apps/api/src/agent/tools/trip-flow.ts` (`AgentTripFlow`, Redis `agent:tripflow`)              |
| Options chosen by number         | `apps/api/src/agent/tools/agent-options.ts` (Redis `agent:options`), the search tools          |
| Each prepare hands the next part | `apps/api/src/agent/tools/checkout-tools.ts` (`option`, `next`)                                |
| Skipping a part                  | `apps/api/src/agent/tools/trip-flow-tools.ts` (`trips.next_part`)                              |
| The checkout                     | `TripCheckoutTools.summarize()`; the trip card opens `/trips/{id}/details` (ADR-118)           |
| Routing                          | `tripPlanning` in the run's context (`@suskii/shared`), the supervisor in `apps/agent`         |
| Prompts and evals                | `apps/agent/src/prompts/prompts.ts` (`FLOW`), routing r104 to r106, grounding g18              |
| Choose buttons                   | `choose` on a card; `apps/web/components/assistant/assistant-chat.tsx`, `assistant-screen.tsx` |
| Words                            | `assistant.cards.choose`, `chooseLabel` and `chosen` in five catalogs                          |
| Guide                            | `apps/api/src/agent/platform-guide.ts` (`combined_trips`, `ask_suskii`)                        |

## Risks and how they are met

- **A model setting its own order.** The order is code. Each prepare tool returns the next part's
  options itself, so the model only shows them.
- **Dates or travellers typed again by a model.** They come from the prepared flight. The only
  exception is the children's ages, which only the traveller can give.
- **"Option 2" naming something else.** Options are remembered per conversation and kind for as
  long as the search lasts, and only the newest answer offers buttons.
- **A trip changed half way.** A new flight for other days or another place forgets what was
  chosen for the old one.
- **Too many cards.** An answer holds at most the chosen part and four options, within the six
  an answer keeps.

## Outcome

Built and tested on 2026-11-15:

- **API:**
  - The tool registry's e2e takes a signed in traveller from flight option 1 through a hotel, a
    car and a transfer to the checkout. Insurance was passed over because none is offered. The
    trip is paid once, and its card opens the details form.
  - A guest family is asked the children's ages before a stay and to sign in before a car. Their
    checkout is per part, with the sign in note.
  - Unit tests cover the times, the rooms, the trip's facts and the options store.
- **Agent service:** routing keeps a planning conversation with the trip planner. The prompts
  pass, with new routing and grounding cases on recorded answers.
- **Website and app:** a Choose button on the newest answer sends the choice as the traveller's
  words. The app's Jest test and the website's e2e check that an older answer offers none.

One thing waits: the evals against the real model (`infra/gcp/cloudbuild.agent-eval.yaml`) must
run before the new prompts answer travellers.
