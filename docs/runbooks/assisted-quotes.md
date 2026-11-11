# Assisted quotes and the approvals queue

**Signal:** the approvals list shows assisted quotes or bookings waiting (`alsoWaiting`), a
traveller asks where their quote is, or a paid assisted booking has waited more than a working
hour. The operations assistant's `ops.queues` and the metrics `suskii.assisted_quotes` and
`suskii.agent.approvals` count the same things.
**Console:** until the pages of sub-phase F exist, the admin API: `GET
/v1/admin/assisted-quotes?queue=to_verify|to_book` and `GET /v1/admin/ai/approvals`.
**Background:** ADR-104 (assisted quotes), ADR-107 (confirmations and approvals).

Nothing here is automatic on purpose. An assisted quote is sold only after a person verified
its price, and confirmed only after a person booked it; an agent's proposal does nothing until
someone other than the person who asked approves it.

## 1. A request waits to be verified (`to_verify`)

A request closes by itself as `expired` after `ASSISTED_QUOTE_REQUEST_HOURS` (48) and the
traveller sees that it ran out of time, so answer the oldest first.

1. Read the request: what is wanted, the place, the dates and how many travel, and, when it
   came from a price seen on a website, that price with where and when it was seen. That price
   is a hint. It is never what the traveller is charged.
2. Check the live price and availability with a supplier Suskii has an account with. Keep the
   proof (a screenshot or the supplier's quote) where staff can open it over https.
3. **It can be had:** `POST /v1/admin/assisted-quotes/{id}/offer` with the supplier's name,
   the supplier's price in the supplier's currency, the address of the proof and what exactly
   is offered (title, a short summary with what is included, the dates, whether it can be
   refunded). The API adds the fee rules of the product "Assisted quotes" and makes an offer
   the traveller can book for `ASSISTED_QUOTE_VALID_MINUTES` (120). They are told by email and
   push.
4. **It cannot:** `POST /v1/admin/assisted-quotes/{id}/close` with a reason from the list
   (`sold_out`, `price_not_available`, `supplier_declined`, `not_sold_by_suskii`, `duplicate`,
   `other`). The traveller is told and can ask again.
5. An offer that lapsed can be offered again with a fresh check of the price: repeat step 3.

Needs `ai:approve`. Never write a traveller's name, phone number or email address into the
title or the summary: the names of who travels are on the booking.

## 2. A paid booking waits to be booked by hand (`to_book`)

The traveller has paid; the booking stays "being confirmed" until one of these two steps. The
ticketing sweep does not touch it.

1. Book with the supplier at the verified price, in the traveller's names as the booking
   shows them.
2. **Booked:** `POST /v1/admin/assisted-quotes/{id}/booked` with the supplier's confirmation
   reference and the address of the proof. Only this confirms the booking; the traveller gets
   the ordinary confirmation message.
3. **Cannot be booked** (sold out, the supplier's price moved, the supplier declined): `POST
/v1/admin/assisted-quotes/{id}/unbookable` with the reason. The booking goes to "refund
   pending" and everything the traveller paid is refunded automatically. Nobody is asked to
   pay more after paying: if the price moved, make a new offer on a new request.
4. Never mark a booking booked on a supplier's promise. Without a reference it is not booked.

Needs `bookings:manage`. If the refund of an unbookable booking does not settle, follow
[Failed webhook replay](failed-webhook-replay.md) and the refunds page, as for any refund.

## 3. A proposal waits in the approvals queue

What a staff assistant prepared: a refund request or a promo code. `payload` is exactly what
approving it would do.

1. Read it as if a colleague had handed you the form filled in. Check the booking and the
   payment yourself (Bookings in the console); an assistant can be wrong.
2. **Approve** (`POST /v1/admin/ai/approvals/{id}/approve`, with an `Idempotency-Key`): the
   ordinary service runs as you.
   A refund request becomes your own request and then follows the refund rule (a second
   approver above the threshold: not you). A promo code is created switched off; switching it
   on is a separate decision on the promo page.
3. **Reject** (`.../reject` with a reason from the list): nothing happens.
4. You cannot decide a proposal your own question produced (403 `own-approval`), and you need
   the permission to do the thing yourself (`refunds:request` or `deals:manage`) besides
   `ai:approve`.
5. `failed` means the ordinary service refused it at approval (the amount is no longer
   refundable, the code is taken): nothing changed. Ask the assistant again or make the
   request by hand.
6. A proposal nobody decides lapses after 7 days.

## 4. A traveller says they confirmed something and nothing happened

A confirmation card does what it showed or nothing.

1. Look at the booking's timeline: a cancellation, an accepted airline change or a refund
   offer taken through a card is there like any other, with the traveller as the actor.
2. If it is not, the card expired (15 minutes, or a new message was written first), the
   facts changed (the refund was no longer what the card showed) or the supplier could not be
   reached. The traveller can ask the assistant again or use the booking page; both lead to the
   same service.
3. Typing "yes" in the chat confirms nothing. Only the button on the card does.

## Levers

- **Stop taking requests:** `ASSISTED_QUOTES_ENABLED=false`. Travellers' routes then answer
  404, no offer can be made and an offer made before cannot be paid for. The queue stays open
  to staff: a booking already paid must still be booked or marked unbookable (section 2), and a
  request that waits should be closed (section 1, step 4) so nobody waits for nothing.
- **Pause the assistants:** Console, AI, Pause (`POST /v1/admin/ai/pause`). Chats stop, cards
  cannot be tapped, the ordinary screens work. The approvals queue and the assisted quote
  queue stay open to staff.
- **Advice only:** set an agent or a tool to `manual` (`PUT /v1/admin/ai/autonomy`): it then
  prepares no card and no proposal.
