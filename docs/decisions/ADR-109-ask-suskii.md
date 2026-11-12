# ADR-109: Ask Suskii: Gemini, one button that moves, bookings prepared for the traveller, and plain copy

- Status: Accepted
- Date: 2026-11-12
- Deciders: the owner (asked for it after trying the test app, with a reference picture),
  Claude Code (implementer)
- Amends: ADR-101 (where the assistant is offered), ADR-106 (the model provider), ADR-107 (what
  an agent may do: a new kind of `propose` tool), ADR-013 and ADR-043 (the homepage's script
  budget is kept), ADR-088 (a moving control), ADR-076 (how copy is written)

## Context

The owner asked for one assistant for the whole platform:

1. It is called **Ask Suskii**, not "AI assistance".
2. It runs on Google's **Gemini 2.5 Flash**.
3. Its button looks like the pill in the reference picture and is **not static**. Clarified
   later: one button, never several at once, that appears in different places and is not seen
   in one place only.
4. It answers questions, works with the agents already built, and has a deep knowledge of the
   platform.
5. It can **book flights, hotels and car services** for a customer.
6. After a flight is booked it **asks whether the customer also needs a hotel, a car** and so on.

Later the same day the owner added a rule for all copy: no dashes or hyphens anywhere a customer
reads, and nothing that reads as machine written.

The hard lines of the agent work stay as they were (ADR-107, section 6 of the brief): a model
never moves money, never confirms a booking and never takes a traveller's personal details.

## Decision

### The name

"Ask Suskii" is the assistant's name in every language, on its button, its page and beside its
answers. Running text still calls it "the assistant" where it describes what it is ("This is an
automated assistant").

### Gemini

The agent service has a second model adapter, `GeminiAgentModel`, beside the Anthropic one,
behind the same `AgentModel` interface. `AGENT_MODEL_PROVIDER=gemini` selects it, and it is the
default of a deployed agent service (Terraform, the Helm chart). Anthropic stays as the other
provider; `mock` stays the default on a developer's machine and in every test.

- It calls the Gemini API's `generateContent` over plain HTTPS: no SDK, the key in the
  `x-goog-api-key` header and never in the address, no redirects, one timeout, no retry (the
  graph tries the fallback model once, as before).
- With no model named, all three roles (router, specialist, fallback) use `gemini-2.5-flash`.
  A 2.5 Flash model answers with thinking switched off, which keeps a turn fast and cheap;
  Gemini 3 and later take `AGENT_MODEL_THINKING_LEVEL` (low unless set) and get the thought
  signatures of their tool calls back, as that API requires.
- Vendor payloads stay inside the adapter. A blocked prompt or a safety stop is a refusal; a
  cut answer is `max_tokens`; a rate limit or a server error is "unavailable" and tried once
  more on the fallback.
- Its price is in `DEFAULT_AGENT_MODEL_PRICES` (Google's list price for the paid tier, read on
  2026-11-12), so the console's cost figures are not zero.

Two things the owner must know:

- **Google serves the 2.5 models only to projects that have used them.** A key of a new
  project may be refused `gemini-2.5-flash`. The fix is a setting, not code: name the current
  Flash model in `AGENT_MODEL_ROUTER`, `AGENT_MODEL_SPECIALIST` and `AGENT_MODEL_FALLBACK` and
  price it in `AGENT_MODEL_PRICES`. The adapter speaks to both generations.
- **No eval has run against Gemini.** The three agent evals pass on recorded answers, which
  prove the graph, the guard and the tools. What the model itself does is measured by one run
  of `agent-eval.yml` with the Gemini key before the assistant answers travellers (ADR-106).
  Whether Google may use the conversations to improve its models depends on the tier of the
  key (paid or free) and the terms the owner accepts: confirm it before production, and use a
  paid key.

### One button that moves

There is one entry to the assistant, on every screen that may show it.

**Website.** `AskSuskii` is rendered by the root layout on the server, only while
`GET /v1/agent/status` says the assistant is available. It is a link to `/assistant` with a
robot mark and the name, fixed over the page. It rests in four places in turn (a lower corner,
half way up that side, half way up the other side, the other lower corner), glides from one to
the next every 15 seconds, and starts each page load in a place the server picks at random.
All of it is CSS: one `@keyframes` on `translate`. No script ships for it, so the homepage
budget of ADR-043 is untouched (the budget test passes unchanged).

- It waits while the pointer is over it or the focus is in it.
- While someone moves through the page by keyboard it stays in its corner, and the page's
  scroll padding keeps what has the focus clear of that corner (WCAG 2.4.11).
- While someone types in a field it is not shown: on a phone the keyboard leaves no room.
- "Reduce motion" stops the gliding; the button then stays where the page load put it.
- A small cross puts it away for the visit. It is the label of a visually hidden checkbox, so
  it works without a script and by keyboard (WCAG 2.2.2: what moves can be put away).
- Pages that carry `NoAskSuskii` never show it: checkout, a booking, a trip's page, the
  metasearch landing, the sign-in forms and the assistant's own pages. The cookie prompt holds
  it back until a choice is made. The stylesheet does this with `:has()`, because the root
  layout is not rendered again when a visitor moves between pages.
- The phone menu keeps its "Ask Suskii" line for a visitor who put the button away. The link in
  the top bar is gone: one button.

**App.** `AskSuskiiButton` is mounted once, over every screen. It takes a new place each time
another screen opens and moves on every 15 seconds. A finger can drag it anywhere; it then
stays there until the next screen. Its cross puts it away until the app starts again, and only
then does Account offer the assistant, so there is never more than one way in on a screen. It
is hidden while the keyboard is up and on the screens listed in `showsAskSuskii` (the
assistant, sign-in, checkout, a trip, a live ride, the account's pages, support, staff
screens). With "reduce motion" or a screen reader on, it changes place between screens and
never glides.

A button that travels can pass over a control. That is the cost of what was asked for, and it
is bounded: it rests for 15 seconds, it can be dragged or put away, and it is never on a
payment or sign-in screen. The phone flows that are about something else put it away first, as
a traveller can.

### Bookings prepared for the traveller

"The assistant books for me" is built as far as the hard lines allow, which is almost all of
it. Three tools, tier `propose`:

- `flights.prepare_booking` takes the id of a flight option the search returned.
- `hotels.prepare_booking` takes the id of a rate.
- `cars.prepare_booking` takes a car and the pick-up and return times (signed-in travellers).

Each does what a tap on that result does on the website or in the app: asks the supplier for
the price as it is now, keeps it as an ordinary quote and returns a card that opens the
checkout for that quote. The traveller enters names and documents there, never in the chat, and
pays on the hosted payment page. The price check before payment, fulfilment, cancellation and
refunds are the ordinary pipeline's.

- Nothing here creates a booking, holds a seat or takes money. The result always says
  `bookingStatus: 'not_booked'`, and the answer guard refuses "booked", "reserved" or "paid"
  for it: the assistant says the booking is prepared and waits for details and payment.
- The search tools now return an `offerId`, a `rateId` or a `carId` for the model to hand
  back. They are opaque, expire with the search (30 minutes) and are never shown to a
  traveller.
- Two notes go with the card whatever the model wrote: `booking_handoff` (nothing is booked or
  paid yet) and, after a flight, `other_services`.
- The app opens such a card in its own checkout screen; the website follows the link.

### "Do you also need a hotel or a car?"

`flights.prepare_booking` also returns where the traveller will be and when (`stay`: city,
country, arrival, and the day of the flight back on a return trip) and `alsoOffer`. The flights
and trip specialists are told to ask once, right after a flight is prepared, whether a place to
stay, a car, an airport transfer or travel insurance is wanted for those dates, and never to
ask again in the conversation. The `other_services` note says the same in the client's own
words, so the offer is made even if the model forgets. A "yes" is an ordinary message: the
router sends it to the hotels or cars specialist, who searches for the dates already said.

### Knowing the platform

`platform.guide` is a read tool every customer agent has. It returns, for one of 13 topics,
what a traveller can do and where (the pages), with what is switched on in this environment
and the currencies offered. The text ships with the code (`platform-guide.ts`) and holds no
price, fee, hour or promise: those come from the tools that read live records or from the
documents staff keep in the knowledge base. A change to a feature a traveller sees changes its
topic in the same change.

### Plain copy

No customer reads a dash or a hyphen, and nothing reads as machine written.

- English copy joins no two words with a hyphen ("sign in", "check in", "pickup", "top up",
  "two step verification", "WiFi", "not refundable"). The products once called "add-ons" are
  "travel extras". An "e-ticket" is a "ticket".
- No language uses a dash as punctuation. A range is written with a word: "10 Dec to 17 Dec",
  "Lagos to London", "Ages 2 to 11". `format.dateRange` joins the two dates with the
  language's own word on every engine.
- The API's emails, texts and PDFs, the assistant's platform guide and the facts it reads
  follow the same rule, and the assistant is told to write without dashes.
- Catalog tests keep it so: a hyphen between two words in an English string, or a dash as
  punctuation in any language, fails the build.

What stays, and why:

- A format a field needs. The app's typed dates are still entered as `2026-12-01` and
  `2026-12-01T14:30`, and the hint shows that form. The right fix is a date and time picker on
  those 12 fields; it is a change of its own.
- French and Portuguese spelling. "Peut-être", "avez-vous" and "fim-de-semana" are how those
  words are written; removing the hyphen would be a spelling mistake.
- Addresses of pages (`/travel-add-ons`), which are names for machines and for search engines;
  changing them needs redirects.
- What a supplier, a traveller or a model writes: a hotel's description, a review, an answer.

## Consequences

- The assistant can take a traveller from a question to a checkout page with the price
  checked, and then offer the rest of the trip. The last step, details and payment, is the
  traveller's, on the pages that already carry the platform's guarantees.
- Search, booking and payment still do not depend on the assistant: with it off there is no
  button, no page and no change to any journey (the off-mode suite runs as before).
- A second model vendor is supported. Changing vendor is a setting plus an eval run.
- Every prompt of a customer specialist changed (version 3): the recorded evals pass, and the
  model run against Gemini is still owed.
- The movement of the button is a deliberate departure from the usual fixed corner. If it
  proves a nuisance, the places and the rest time are two constants on each client.

## Alternatives considered

- **Let a tool create the booking with details taken in chat.** Refused: names, passport
  numbers and contacts would pass through a model, and a model would confirm a purchase.
- **Several buttons in several places.** Refused by the owner.
- **A script that moves the website's button.** Refused: the homepage has no room for it, and
  CSS does the same.
- **The Gemini SDK.** Not needed: one HTTPS call, and the adapter keeps vendor types inside.
- **Vertex AI instead of the Gemini API key.** A sound later step once the platform runs on
  Google Cloud (a service identity instead of a key, a region of choice). It is an adapter
  change of a few lines; the owner asked for Gemini and a key is the fastest way to it.
