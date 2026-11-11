# ADR-107: What an agent may do: tool tiers, confirmations, approvals and autonomy

- Status: Accepted
- Date: 2026-11-10
- Deciders: the owner (set the hard lines in the brief), Claude Code (implementer)

## Context

An assistant that "handles everything" could be read as one that books, charges and refunds by
itself. It must not. Money and bookings in this platform change only through audited services
after verified events (ADR-014 to ADR-019), and a model can be wrong or be talked into things.
The limits therefore sit where a prompt cannot reach them.

## Decision

### Every tool has a tier, enforced in the gateway

| Tier      | Meaning                                                | Examples                                                                                              |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `read`    | No side effect; only the grant's own customer          | search, read my booking, FAQs, visa rules, exchange rates                                             |
| `propose` | Makes a draft or a pending approval; commits nothing   | a quote, an assisted-quote request, an itinerary, a refund request draft                              |
| `commit`  | Changes state; the API runs it after a person confirms | create a booking, start a payment, accept a new price, cancel                                         |
| none      | Is never a tool                                        | approve a refund, capture, pay out, post to the ledger, change a price rule, sign a supplier contract |

A test reads the tool registry and fails if a tool for the last row exists.

### Money and bookings

An agent never authorises or sends a refund, never captures a payment, never posts to the
ledger, never confirms a booking, and never says a booking or a payment succeeded. Those
statements come from verified records (webhooks, supplier references) that the API renders.
A screenshot from a customer is not proof of payment.

### A commit needs a person's tap

For a `commit` the agent can only ask the API for a **confirmation card**. The API builds it from
its own data (what, for whom, how much as `Money`), stores it and shows it. The traveller taps
confirm; the client calls `POST /v1/agent/confirmations/{id}/confirm` with an `Idempotency-Key`;
the API runs the action through the ordinary service. The model has no way to produce that call:
it carries the traveller's own session, not a grant.

In the graph the wait is an `interrupt()`. LangGraph runs the interrupted node again from its
start on resume, so nothing with a side effect may precede an interrupt in the same node; a test
resumes a run and asserts that no side effect happened twice.

### Staff approvals

Assisted quotes, refund request drafts, campaigns and spend, source-policy approvals and drift
recipes land in one approvals queue. The existing maker-checker rule holds: who asked cannot
approve. Approving a refund stays where it is (the refunds API, `refunds:approve`); an agent can
only prepare the request.

### Autonomy is a setting, not a trait

Each agent and tool has a level: `manual` (advice only), `supervised` (prepares, staff approve)
or `autonomous` (approved low-risk tools within limits). The default is `supervised`.
Customer-facing `read` tools are autonomous from the start. Raising a level needs step-up and
leaves an audit entry.

### What the model sees, and what it may say

- No names, contact details, passport data, ticket numbers, confirmation codes or payment
  details: facts under keys only (ADR-105).
- Every amount, date, time, link and phone number in a reply must come from a tool result or a
  cited knowledge source of that turn (`checkAnswer`, extended). Otherwise the reply is blocked
  and rewritten or handed to a person. Prices and currencies are taken from the `Money` in the
  tool result and formatted by the shared formatters.
- A customer sees only their own conversations and bookings, and anyone else gets 404. Tools
  take the caller from the grant; a cross-customer test matrix proves it.

### Untrusted text stays data

Tool results, supplier text, scraped data, uploads and knowledge text can contain instructions.
They never change a tool's permissions, the system prompt or the target of an action. A red-team
corpus runs in CI.

### Abuse, cost and the stop button

The existing rate limits and bot protection apply. Cost is capped per user and globally with the
ADR-061 reservation. A global pause is a Redis flag that takes effect within seconds: chat
answers that the assistant is paused and clients fall back to the ordinary screens.

### Language

Replies are in the traveller's language (the seven of ADR-076); Nigerian Pidgin is understood as
input.

## Rejected

- **Putting the limits in the prompt.** A prompt is a request to a model, not a control.
- **Letting an agent commit low-value actions unasked.** There is no amount below which a
  traveller's money moves without their tap.
- **A separate approvals screen per kind.** One queue is worked; five are forgotten.

## Consequences

- The assistant will sometimes say "tap to confirm" or "a person will check this" where a bolder
  one would act. That is the design.
- Every state change by an agent or by staff through the agent has an audit record.
- Raising autonomy is possible later, one tool at a time, with evidence from the evals.

## Amendments made while building it

- **Confirmation cards arrive with the first commit tool** (sub-phase E): the table, the
  confirm route and the card. The graph's side is built and tested now: a commit call becomes
  an interrupt, the run ends as `confirmation`, and a resume carries only what the API's records
  say after the tap. No commit tool is registered yet, and a test fails if one is.
- **What the guard checks before an answer is shown**, all in code and in every language the
  assistant answers in: figures, links, email addresses and phone numbers against the turn's
  tool results and the traveller's own words; "confirmed", "paid", "refunded" and "cancelled",
  also as "I have booked, paid, refunded, cancelled", against the statuses the tools returned;
  its own instructions read back word for word; a tool named; a request for a card number, a
  code, a password or a document number; and length. One rewrite, then a notice.
- **A refused draft is never a source.** A turn keeps what the traveller wrote apart from what
  the model was shown, so neither the model's rejected answer nor the guard's note about it can
  ground the next try. The grounding eval found this hole; a test holds it shut.
- **A rule about how something is paid is not a payment**: "the government fee is paid
  separately" passes; "your booking is paid" needs a status.
- **Two tools prepare something**: `trips.plan` starts a combined trip (ADR-099) for the
  signed-in traveller, which books and holds nothing, and `support.handover` opens one support
  conversation (ADR-083) with the traveller's own last messages as its first one, never a
  model's account of them, under the topic `assistant_handover`, on which the after-hours
  assistant is not consulted. A second handover while one is open returns the open one. A guest
  is shown the support page, which starts a conversation with a human check and an address to
  answer to.
- **A refusal reaches the model as a code** (`date_in_past`, `unknown_airport`, `not_offered`,
  a problem's slug), never a sentence, and a supplier that is down is `failed` without an error
  report: it is not a fault of ours.
- **A supplier's names** (hotel, area, room) reach a model without links, addresses or markup,
  because an answer may quote a contact a tool returned.
- **Confirmations are built** (sub-phase E). A `commit` tool has a `prepare()` beside its
  `run()`: the gateway calls `prepare()`, which reads the records and answers what the card
  shows (a kind, a title, lines, amounts as `Money` under the codes `refund`, `kept` and
  `target`, the record it is about) and what must still hold at the tap (`expected`, such as
  the quoted refund). The gateway stores that as an `agent_confirmations` row and answers the
  model `confirmation_required` with its id; nothing else happened. The traveller reads the
  card (`GET /v1/agent/confirmations/{id}`) and taps `confirm` (their own session and an
  `Idempotency-Key`) or `decline`. The tap claims the row with a conditional update, runs the
  tool with a grant built from the session, never the model's, and stores what the records
  then say as facts under keys; the assistant is resumed with those facts and may say no more
  than they hold. A card whose facts changed (the refund is no longer what was shown) does
  nothing and says so.
- **One card at a time.** A conversation has at most one pending confirmation (a partial
  unique index); a new message expires it, so "yes, do it" typed in the chat confirms nothing.
  A card lives 15 minutes, or as long as the quote under it. A tap is refused while the
  assistant is paused (503), and at autonomy `manual` no card is prepared at all.
- **Five commit tools**: `bookings.cancel` (the product's own cancellation, with the refund
  the policy gives shown on the card), `changes.accept` (an airline's new times),
  `changes.take_refund_offer` (the full refund after a significant change, ADR-073: the airline
  cancels first), `alerts.watch` and `alerts.stop` (a price watch, ADR-032). Each calls the
  ordinary service as the traveller. Creating a booking and starting a payment are not tools:
  the assistant gives a link to the ordinary checkout.
- **The approvals queue is built** (`agent_approvals`, `/v1/admin/ai/approvals`) for what a
  staff agent prepares. Two kinds exist: `refund_request` and `promo_code`. A proposal holds
  exactly what would be done, as the kind's own schema (ids, amounts, codes), and changes
  nothing. Deciding needs `ai:approve`, the kind's own permission (`refunds:request`,
  `deals:manage`) and to be someone other than the person whose question produced it (403
  `own-approval`). Approving takes an `Idempotency-Key`, claims the row and runs the ordinary
  service as the approver: a
  refund request is the approver's own and still waits for its second approver where the
  threshold says so, so no step of maker-checker is skipped; a promo code is created switched
  off. If the ordinary service refuses, the proposal ends as `failed` and nothing changed. A
  proposal lapses after seven days; one person has at most twenty waiting; the same proposal
  asked twice is one row.
- **Assisted quotes have their own queue** (ADR-104); the approvals list counts them. Source
  approvals stay on the data sources page with step-up (ADR-102). Campaign spend and drift
  recipes are not built: no agent prepares them yet.
- **Staff agents answer in the console only**, to staff with `ai:read`
  (`/v1/admin/ai/conversations`, `/v1/admin/ai/chat`). A person reaches the agents whose part
  of the platform their own permissions open (`STAFF_AGENT_SCOPES`: operations with
  `bookings:manage`, finance preparation with `refunds:request`, marketing with
  `deals:manage`, business intelligence and the executive assistant with `reports:read`, price
  intelligence with `datasources:manage`), and each tool is checked against the grant's scopes
  again. A staff conversation is its owner's alone (404 for every other staff member) and is
  never opened by the travellers' routes. The audit log records that a question was asked, in
  which conversation and run, never its words.
- **Eight staff tools**, six that read and two that prepare: `ops.queues`, `reports.sales`,
  `finance.overview`, `finance.booking_payments`, `marketing.promos`, `sources.overview`,
  `finance.draft_refund_request` and `marketing.draft_promo`. They return counts, amounts, ids
  and codes; none returns a traveller's name, contact or booking reference. A refund reason is
  one of the staff refund reasons, so a model's sentence (or a traveller's screenshot retold)
  never becomes the reason on a refund.
- **Autonomy as built** has two effective levels for a tool that prepares or commits: `manual`
  prepares nothing, and `supervised` prepares for a person. `autonomous` changes nothing yet:
  no tool acts without a person, and none will until an eval and the owner say so.
