# ADR-085: After-hours support assistant

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Part 3 of roadmap item 9. Travellers write to support at any hour (ADR-083, ADR-084). Until
the owner staffs every hour, a message sent at 2 a.m. waits for the morning, even when the
answer is already in the FAQs ("can I pay in parts?") or on the traveller's own booking ("is my
hotel paid?", "when does my flight leave?"). The homepage also promises 24/7 support.

AI trip search (ADR-061) already has the pieces: a provider interface with a mock and a Claude
adapter, structured output, a cost reservation in Redis, text scrubbing, and an eval run in CI
with recorded answers and against the model on demand.

What makes support different from search:

- The model's words reach the traveller directly, not as editable form fields. A wrong answer
  about money or a departure time is worse than no answer.
- The traveller can ask for things only a person may do (cancel, refund, change a name), and
  can try to talk the model into promising them.
- A booking's facts are personal data, and they must leave for the model to answer about them.

## Decision

1. **When it answers.** After a traveller's message commits (website, app or WhatsApp), the
   assistant answers if all of these hold:
   - `SUPPORT_ASSISTANT_ENABLED` is set (off by default in every environment);
   - nobody is on shift: the time is outside `SUPPORT_HOURS` in `SUPPORT_TIME_ZONE`
     (`mon-fri 08:00-20:00, sat 09:00-14:00`; empty means no staffed hours, so it answers at
     any time);
   - no staff member has replied in the conversation yet (once a person is there, it is quiet);
   - it has answered fewer than `SUPPORT_ASSISTANT_MAX_REPLIES` times (default 3) in the
     conversation;
   - the message is text (not an attachment marker or STOP) and the conversation has room;
   - the spend caps allow the call.

   A lock per conversation (Redis, one minute) stops two quick messages from producing two
   answers; the run answers every unanswered message at once and looks again before it ends.

2. **What it sees.** Three things, in this order:
   - the published FAQs (default locale), each with its id;
   - when the conversation is about a booking, that booking's facts, each with a key
     (`booking.status`, `flight.1.departure`, `hotel.free-cancellation`, ...), built by
     `assistantBookingFacts()` from the traveller's own booking view: status, product, places,
     local dates and times, what was paid and what is due (and when), refundability, free
     cancellation dates, baggage, open airline changes, refunds in progress and which documents
     are ready. Never names, contact details, passport data, ticket numbers, voucher codes, the
     airline's or hotel's confirmation codes or our booking reference;
   - the traveller's messages since the last answer (up to three, at most 2,000 characters),
     scrubbed by `scrubQuery()`.

   The request carries no user, conversation or booking id. The booking was attached only
   after `BookingsService.load()` succeeded for the traveller (ADR-083), so the background run
   may read it by id.

3. **What it may say.** The model returns a JSON object (structured output, validated again
   with Zod): `answerable`, `answer` and `sources` (the FAQ ids and fact keys it used). Code
   then checks the answer, and anything that fails becomes a handover:
   - `answerable` is true, the answer is not empty and is at most 1,200 characters;
   - at least one source, and every source is an FAQ id or fact key it was given;
   - every figure in the answer (amounts, dates, times, counts) appears in the cited sources;
   - every link, email address or phone number in the answer appears in the cited sources.

   The system prompt forbids promising or describing actions as done, and tells the model to
   answer in the traveller's language and to hand over when the sources do not answer the
   question. The figure and link checks are what make a hallucinated amount or a made-up phone
   number impossible to send, whatever the prompt says.

4. **How it answers.** A message with author `assistant`:
   - an answer (`kind: text`), with the cited sources stored on the message
     (`assistant_sources`) for staff;
   - or, once per conversation, a handover (`kind: handover`) saying the team is offline and
     will reply in the conversation. Clients show their own translation; the stored body is the
     English text for older clients and WhatsApp.

   Clients label assistant messages "Automated answer" and add that a person will also read
   the conversation. On WhatsApp the message goes through `WhatsAppReplies.deliver()` (the
   window is open: the traveller has just written).

5. **It never acts and never closes.** The assistant has no tools. It does not change the
   conversation's status, priority, assignee or SLA fields (`replyOwedSince` stays, so the
   first response is still a person's), sends no notifications, and is not an audit actor.
   The traveller can mark the conversation solved if the answer was enough.

6. **Model and cost.** The model settings are AI trip search's (`LLM_PROVIDER`, `LLM_MODEL`,
   `LLM_API_KEY`, prices), so one key and one price table serve both. `AiSearchBudget`
   reserves under its own keys and caps: `SUPPORT_ASSISTANT_DAILY_MICROUSD` (default $5 a day
   for everyone) and `SUPPORT_ASSISTANT_CONVERSATION_MICROUSD` (default 2 cents per
   conversation per day). Production refuses the mock model while the assistant is on, unless
   `ALLOW_MOCK_PROVIDERS` is set.

7. **Eval.** 40 conversations over 12 FAQs and 5 bookings (`support-assistant-eval.json`):
   answers from FAQs and from booking facts, questions the sources do not answer, requests for
   actions, prompt injection, private-data fishing and messages in French, Swahili, Arabic and
   Portuguese. Each case says whether an answer or a handover is right, what an answer must
   contain and which sources it must cite. The run fails below 90% passed cases, or on any
   answer where a handover was expected (zero tolerance). CI runs the pipeline with recorded
   answers on every change, including deliberately bad ones the checks must turn into
   handovers; `ai-eval.yml` runs it against the model.

## Consequences

- Travellers get an instant, sourced answer after hours to common questions and questions
  about their own booking; staff see what was said and on what basis.
- A booking's non-identifying facts reach the model provider. They are covered by the
  provider's terms (the owner's open question on standard or zero data retention, ADR-061)
  and listed in `docs/security/external-communications.md` and the data classification.
- The checks will turn some correct answers into handovers (a figure written differently from
  its source, such as "1 December" for 2026-12-01 is accepted, but "the first of December" is
  not); a handover costs only waiting for a person.
- Assistant answers are not counted as first responses; SLA reports stay about people.

## Alternatives considered

- **A separate chatbot flow.** Rejected: a second conversation store and inbox, and travellers
  would have to start again with a person.
- **Letting the model call tools (look up bookings, start cancellations).** Rejected: the
  assistant must never act, and the facts it needs are few enough to give it up front.
- **Retrieval over a vector index of FAQs.** Not needed at this size (tens of FAQs fit in a
  cached prompt); revisit when the help centre grows past what fits.
- **Answering during staffed hours too.** Possible later by leaving `SUPPORT_HOURS` empty;
  the default keeps people first when they are there.
