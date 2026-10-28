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

## Outcome

Built as planned; nothing in the plan was dropped.

- **API** (`apps/api/src/reviews`): eligibility through the booking (owner or guest token, 404
  for anyone else), write and change while waiting, withdraw, public pages and summaries,
  moderation (publish, reject with a reason) with totals in the same transaction, audit for
  every step, automatic flags, hotel subjects matched across suppliers, and invitations planned
  for the morning after the trip and sent once. Bus trips carry the operator's id and hotel
  results `verifiedReviews` (both additive, no client breaks).
- **Database**: `review_subjects`, `reviews`, two booking columns for invitations and the
  `review_requests` notification category (expand-only migration
  `20261031120000_verified_reviews`, checked by `check:migrations`).
- **Privacy**: reviews in the data export; deletion removes unpublished reviews and keeps
  published ones without the account or name; rejected reviews purged after 90 days; names
  cleared when a booking is anonymised; data registry, security docs and store forms updated.
- **Worker**: an hourly sweep (`REVIEW_INVITATION_SWEEP_MINUTES`).
- **Website**: reviews on package, tour, rental and bus pages (JSON-LD ratings only on indexed
  pages with published reviews), the verified score on hotel results and the hotel page, and the
  review form on a finished trip's booking page.
- **App**: the review form on the trip screen and reviews on package and tour screens.
- **Console**: the Reviews page (queue, flags, publish, reject), in the content manager's and
  support's menus.

Verification on this branch (local):

| Check                               | Result                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| Lint and typecheck, every workspace | 25 of 25 tasks                                             |
| API unit tests with coverage gates  | 579 passed (49 suites)                                     |
| API e2e                             | 508 passed (47 suites), then buses, reviews and Cars rerun |
| Shared, i18n, worker                | 233, 33 and 49 passed                                      |
| App (Jest)                          | 245 passed (43 suites)                                     |
| Admin e2e                           | 16 of 16, including the moderation journey                 |
| Website e2e                         | 114 of 114 (budgets, hydration, slow 3G, Lighthouse)       |
| Security checklist, format, scripts | up to date, clean, 13 of 13                                |

What waits for the owner: who moderates (content managers and support hold
`reviews:moderate`), the window (default 90 days), whether Suskii may answer reviews publicly,
and invitations by WhatsApp once a provider is chosen. The website's booking-page test answers
the two review calls in the browser, because the web e2e stack cannot move a trip into the
past; the API e2e and the admin e2e exercise the same rules against the real API.
