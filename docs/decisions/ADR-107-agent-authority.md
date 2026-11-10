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
