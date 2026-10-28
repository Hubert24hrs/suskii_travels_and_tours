# ADR-077: Verified reviews

- Status: Accepted
- Date: 2026-10-28
- Deciders: owner (verified reviews with moderation), Claude Code (design)
- Context: [ADR-028](ADR-028-in-house-fulfilment-vouchers-and-cancellation.md),
  [ADR-029](ADR-029-account-data-rights-export-and-deletion.md),
  [ADR-034](ADR-034-admin-route-permission-matrix-and-audit-coverage.md),
  [ADR-071](ADR-071-hotelbeds-hotel-adapter.md)

## Context

The owner asked for reviews of hotels, tours, buses and rentals, written after the trip and
moderated, for trust and for search engines. Booking.com shows only reviews from guests who
stayed; that is the standard here. Consumer rules in the UK (DMCC Act 2024), the EU (Omnibus
Directive) and Nigeria (FCCPA) treat fake or unverifiable reviews as misleading and require
sellers to say how they check them.

Hotels have no identity of their own in the platform: the same hotel can come from two suppliers
under different ids, and its page URL expires with the search.

## Decision

1. **Who can review.** The owner of a booking (signed in) or the holder of its guest link
   (`BookingsService.load()`), for one item of kind hotel, package, tour, bus or rental, when:
   - the booking is `CONFIRMED`;
   - the trip has ended: the item's end date (`tripFacts`) is before today, the same rule as
     account deletion uses; and
   - it ended no more than `REVIEW_WINDOW_DAYS` (default 90) ago.

   One review per booking item (a unique key). Flights, visas, add-ons and rides are out:
   airlines are not reviewed here, and rides already have driver ratings.

2. **What a review holds.** An overall rating from 1 to 10 (the scale hotel scores already use),
   an optional title (100 characters), what the traveller liked and disliked (1,000 each), the
   kind of trip (solo, couple, family, friends, business), the month of travel and the language
   it was written in. The name shown is the lead traveller's first name and last initial, or
   "Verified traveller" when they choose not to show it. No photos, replies or votes yet.
3. **What is reviewed.** A review attaches to a subject: a package, a tour, a bus operator or a
   rental vehicle by its id, or a hotel. A hotel subject is found by normalised name within
   250 m, the rule search uses to merge duplicate hotels (`hotelNameKey`), so a hotel keeps its
   reviews whichever supplier sold it. Each subject keeps the sum and count of its published
   ratings, updated in the same transaction as each moderation decision.
4. **Moderation.** Every review waits for a moderator with `reviews:moderate` (content manager,
   support and super admin). Contact details and links in the text are flagged automatically.
   A moderator publishes or rejects with a reason code (`personal_data`, `offensive`,
   `off_topic`, `spam`, `conflict_of_interest`, `unlawful`). Nobody edits a traveller's words;
   the traveller can change a review while it waits and withdraw it at any time. Every decision
   is audited.
5. **Showing reviews.** A subject shows its verified score (average to one decimal) and count,
   and its published reviews newest first, in the language they were written. Each section says
   that only travellers who booked and finished the trip with Suskii can write one. Hotel
   results show the verified score next to the supplier's own score, labelled apart.
6. **Invitations.** A worker sweep sends one invitation per booking the day after its first
   reviewable item ends: an email to the booking contact with a link to the booking (with the
   guest access link for guests), and a push to account holders. Account holders can turn it off
   with the new `review_requests` notification category.
7. **Search engines.** Package, tour and rental pages emit `Product` JSON-LD with
   `aggregateRating` and up to five `review` entries, only from published reviews and only when
   at least one exists, matching what the page shows. Hotel and bus pages are not indexed and
   emit none.
8. **Personal data.** Reviews are exported with the account. On account deletion, unpublished
   reviews are deleted and published ones lose their link to the account and the name shown.
   Rejected reviews are deleted 90 days after the decision.

## Consequences

- Scores mean something: every rating comes from a finished, paid trip, and the page says so.
- A hotel's reviews survive changes of supplier, at the cost of a matching rule that can merge
  two different hotels with the same name less than 250 m apart (the same risk search accepts).
- Moderators need time each day; the console shows the queue and its age.
- New reviews take until moderation to appear; travellers see their own as "waiting for review".
