# Verified reviews

Item 6 of the standards plan agreed with the owner on 2026-10-27: verified reviews for hotels,
tours, buses and rentals after the trip, with moderation. Decision record:
[ADR-077](../decisions/ADR-077-verified-reviews.md).

## Owner's brief

Reviews from travellers who really took the trip, for trust and for search engines. Hotels,
tours, buses and rentals; packages are in-house trips too and are included.

## Where the platform stands

- No review model exists. Hotels show the supplier's own score (`reviewScore`/`reviewCount`
  from Duffel; Hotelbeds sends none). Rides have driver ratings (`RideRating`), the pattern for
  "one rating per finished trip".
- Hotels have no identity of their own: a hotel is `supplier` + `supplierHotelId`, the same hotel
  can come from two suppliers, and its page URL holds a search-result id that expires. Search
  already treats two hotels as one when their normalised names match within 250 m
  (`mergeDuplicateHotels`).
- No booking status means "travelled". `CONFIRMED` is the last fulfilled state; the trip's end
  comes from the item (`tripFacts`): hotel check-out, package end date, tour start, bus arrival,
  rental return.
- Booking emails reach account holders and guests alike through the booking contact, with an
  access link for guests (`BookingNotifications`, `BookingAccessLinks`). `BookingsService.load()`
  already authorises owners and guests.
- The console has moderation queues to copy (payment risk reviews: open, approve, reject with a
  reason code, conditional claim, audit).
- Pages emit JSON-LD for the organisation, FAQs and breadcrumbs, but no ratings.

## Plan

| Step | Work                                                                                                                                                        | Files                                                 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1    | Shared: review schemas (rating 1 to 10, liked/disliked text, traveller type, display name), subject kinds, the window, reject reasons; copy in all catalogs | `packages/shared`, `packages/i18n`                    |
| 2    | Database: `review_subjects` (what is reviewed, with running totals) and `reviews` (one per booking item); the privacy registry, export and deletion entries | `apps/api/prisma`, `src/privacy`                      |
| 3    | API: eligibility, write and withdraw a review through the booking (owner or guest token), public lists and summaries, hotel matching across suppliers       | `apps/api/src/reviews`                                |
| 4    | Moderation: `reviews:moderate`, admin list, publish and reject with a reason, audit; automatic flags for contact details and links                          | `apps/api/src/reviews`, `packages/shared/src/rbac.ts` |
| 5    | Invitations: a worker sweep emails the booking contact the day after the trip ends (and pushes to account holders who allow it)                             | `apps/api/src/reviews`, `apps/worker`                 |
| 6    | Website: review prompt and form on the booking page, reviews on package, tour, rental and bus pages, verified scores on hotel results, JSON-LD ratings      | `apps/web`                                            |
| 7    | App: review prompt and form on the trip screen, reviews on package and tour screens                                                                         | `apps/mobile`                                         |
| 8    | Console: the moderation page                                                                                                                                | `apps/admin`                                          |
| 9    | Tests (unit, API e2e with the admin matrix and audit cases, web e2e, mobile Jest, admin e2e) and docs                                                       | everywhere                                            |

## Risks

- **Fake reviews.** Only a confirmed booking item whose trip has ended can be reviewed, once,
  within the window, by its owner or the holder of its guest link. Nothing else can write one.
- **Hotel identity.** A review must follow the hotel across suppliers. Subjects match by
  normalised name within 250 m, the rule search already uses to merge duplicates.
- **Personal data in text.** Reviews can carry names, phone numbers or emails. Contact details
  and links are flagged automatically, everything waits for a moderator, and a moderator can
  only publish or reject, never edit.
- **Consumer law.** EU and UK rules (and Nigeria's FCCPA on misleading claims) require saying how
  reviews are checked. Every review section says so and shows only verified reviews.
- **Search engines.** Ratings in JSON-LD must match what the page shows, and only published
  reviews count.
