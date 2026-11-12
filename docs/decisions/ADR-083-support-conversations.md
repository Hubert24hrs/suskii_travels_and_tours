# ADR-083: Support conversations

- Status: Accepted
- Date: 2026-10-28
- Deciders: Claude Code (implementer), pending owner review

## Context

Roadmap item 9 asks for 24/7 chat and WhatsApp. The spec lists support tickets tied to bookings,
SLA timers in the console and a Prime priority queue. Today the website only links to a phone
number and a WhatsApp click-to-chat from the CMS. Nothing records the conversation, ties it to a
booking or tells staff what is overdue. `support:manage` exists but guards nothing.

## Decision

1. **One model for chat and tickets.** A `support_conversations` row is the ticket and the chat.
   `support_messages` holds the thread. Each message is a traveller's, a staff member's or a
   system message, and a staff message can be an internal note. WhatsApp (part 2) and the
   after-hours assistant (part 3) add channels and authors to the same tables; they do not add new
   flows.
2. **Who can open one.**
   - Account holders can open their own conversations.
   - Guests can open the one conversation their token opens: the access token returned once at
     start, stored only as an HMAC (`support-access`), or a link token from a reply email
     (`{id}.{expires}.{hmac}`, `support-link`, 30 days).
   - Every other caller gets 404.
   - A conversation can be about a booking only if the caller can load that booking
     (`BookingsService.load()`: owner session or booking token).
3. **Who can start one.**
   - Anyone can start a conversation.
   - Without a session, the website needs Turnstile and the app a device attestation (ADR-023).
   - A guest needs an email unless their booking supplies one.
   - An account can have at most five open conversations.
   - A conversation holds at most 500 messages, and per-address rate limits apply.
4. **Priority and SLA.**
   - Priority is `urgent` for a booking whose trip starts within `SUPPORT_URGENT_HOURS` (48) or
     started in the last day.
   - It is `prime` for a member whose plan includes priority support.
   - Everyone else is `normal`.
   - `SUPPORT_SLA` sets a reply target and a resolution target per priority (defaults 15 min / 4 h,
     30 min / 8 h, 2 h / 24 h).
   - A reply is owed from the traveller's first unanswered message. Resolution is due from the
     start of the current open spell.
   - The due times are recomputed from the state on every change (`supportSchedule()`).
   - `due_at` (the nearer of the two) orders the inbox and its keyset paging.
5. **Status.**
   - `open`: staff owe a reply.
   - `waiting`: staff replied.
   - `resolved`: done, set by the traveller or staff.
   - A message on a resolved conversation reopens it with fresh targets.
   - A staff reply assigns an unassigned conversation to whoever replied.
6. **Privacy.**
   - Message bodies are encrypted per message (`support-message:{id}:body`), and a guest's email
     per conversation (`support-conversation:{id}:email`).
   - Reply notices (email, push, text) never include the reply.
   - Logs, metrics and audit entries carry ids and field names only.
   - The data export includes the conversations without internal notes or staff names.
   - Account deletion deletes the account's conversations.
   - Resolved conversations are purged two years after their last change.
7. **Real time.**
   - Clients poll `GET /v1/support/conversations/{id}?after=<last message id>` every few seconds
     while the conversation is visible.
   - A socket can replace polling later through the rides gateway pattern (ADR-052) without any
     change to the data.
8. **Console.**
   - `/v1/admin/support` needs `support:manage` (support staff and super admins).
   - Replies, notes and changes are audited: `support.replied`, `support.note_added` and
     `support.updated` with `fieldChanges()`.
   - Only active staff whose roles carry `support:manage` can be assigned.

## Consequences

- Travellers on the website and in the app can reach a person about a booking. Prime members and
  urgent trips are answered first, and the console shows what is overdue.
- "24/7" still needs people on shift. Part 3 adds an assistant for the hours nobody is.
- No email is read into a conversation yet. Inbound email and WhatsApp come with part 2.
- Attachments (a screenshot, a receipt) are not supported. They need the antivirus pipeline the
  visa documents use and are left for later.

## Alternatives considered

- **A third-party helpdesk (Zendesk, Freshdesk, Intercom).** It is quicker to start, but it would
  copy booking references and personal data into another processor, charge per agent, and not see
  the booking state. The inbox here is small, and WhatsApp comes through the Cloud API either way.
- **WebSockets from day one.** These are faster to feel, but sticky state and reconnection on poor
  mobile networks cost more than polling one small endpoint at this volume.
- **Separate ticket and chat models.** Two models would split one conversation with the traveller
  across two places for staff.
