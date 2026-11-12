# Ticketing backlog

**Alerts:** `TicketingStuck` (a paid booking has waited more than 30 minutes), `TicketingBacklog`
(more than 10 waiting for 15 minutes), `TicketingExhausted` (ticketing gave up),
`WorkerMetricsMissing` (no queue metrics, so the worker may be down).
**Dashboard:** Suskii operations: ticketing backlog and age, queues, supplier errors.
**Background:** ADR-014 (booking lifecycle), ADR-019 (refunds), ADR-040 (payment risk holds).

## How ticketing works

- A confirmed payment moves a flight or hotel booking to TICKETING.
- Every minute the worker calls `/v1/internal/bookings/ticket-due`, which books with the
  supplier. The supplier call uses the booking item id as its idempotency key.
- **Retryable failure:** the next attempt waits 1, 2, 4, 8, then 16 minutes, up to
  `TICKETING_MAX_ATTEMPTS` (6).
- **Definitive failure or no attempts left:** the booking moves to REFUND_PENDING.
  - The balance is refunded automatically, and operations get an email (`OPS_ALERT_EMAIL`).
  - If the supplier may have issued tickets anyway (an ambiguous timeout), the refund instead
    waits for approval in the console, so a person can check first.
- **Interrupted attempt:** a booking whose attempt was cut off (a worker restart) is picked up
  again after 10 minutes.
- **Not part of this flow:**
  - Payments held for a risk review stay PAID until finance decides (console, Payment
    reviews). They are not part of the TICKETING backlog.
  - In-house products (packages, tours, visa, add-ons) are fulfilled in the confirming
    transaction.

## 1. Is the worker running? (2 minutes)

1. Worker health: `GET http://<worker>:4100/health`, and the worker's logs (`worker ready`,
   then sweep lines such as `ticketing attempts made`).
2. Queue depth: `suskii_queue_jobs{queue="bookings"}`. Waiting jobs that do not drain mean the
   worker cannot reach Redis or the API.
3. Worker calls to the API fail? Look for `InternalApiError` in the worker log and Sentry with
   the request id (`worker-<uuid>`). The usual causes are a rotated `INTERNAL_API_TOKEN` or the
   API being down.

Restart the worker if it is stuck: sweeps are safe to repeat. To run one sweep by hand from a
secured operations shell:

```bash
curl -fsS -X POST -H "Authorization: Bearer $INTERNAL_API_TOKEN" \
  "$API_INTERNAL_URL/v1/internal/bookings/ticket-due"
```

## 2. Is the supplier failing?

- Ticketing attempt outcomes are in `suskii_ticketing_attempts_total`, and supplier errors on
  the operations dashboard.
- For each waiting booking, the reason of each failed attempt is in the worker and API logs
  (`ticketing attempt failed` with the booking id) and in the booking's audit timeline
  (console, Bookings).
- If the supplier is down, follow [Supplier outage](supplier-outage.md). Bookings keep retrying
  within their attempt budget.

## 3. Handle bookings that gave up

For each `TicketingExhausted` alert or ops email:

1. Open the booking in the console. Check the timeline, the failure reason and the refund
   created for it.
2. **Automatic refund:** check that it reaches `succeeded` (console, Refunds). Contact the
   traveller: support explains, offers to search again, and confirms the refund timing.
3. **Refund waiting for approval** (ambiguous failure):
   - Check the supplier's dashboard for an order under the booking reference.
   - **No order:** a finance user who did not request the refund approves it (maker-checker,
     step-up).
   - **The order exists with tickets:** reject the refund, note the ticket numbers on the
     booking (console note), and escalate to engineering to complete the booking. Never change
     the booking status by hand.
4. If the traveller would rather be rebooked by phone or email than refunded, record the
   decision in a booking note before anything else changes.

## 4. Verify

- `suskii_ticketing_oldest_age_seconds` is under 5 minutes and the TICKETING count is falling.
- No new `exhausted` outcomes.
- Refunds created during the incident are `succeeded` or assigned in `needs_review`.

## 5. Afterwards

Record how many bookings were delayed, refunded and rebooked. If a held fare lapsed because
ticketing waited on a risk review, raise the review turnaround with finance (ADR-040).
