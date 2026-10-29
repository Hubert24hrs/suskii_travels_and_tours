# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow the delivery phases in
`PROJECT_SPEC.json` until the first production release.

## [Unreleased]

### Text and exchange-rate providers (2026-10-28)

#### Added

- **Texts through Termii and Africa's Talking (ADR-091).** Sign-in codes, booking and safety
  texts go through `SMS_PROVIDER`, with `SMS_ROUTES` sending numbers by calling code to another
  provider (`234=termii`). Termii uses the DND route by default, so codes reach numbers on
  Nigeria's Do-Not-Disturb list. Failures are logged as a provider code, never the number or the
  text.
- **Exchange rates from Open Exchange Rates.** Rates are kept as their exact decimal text. Missing
  or malformed rates are left out, never guessed. `FX_RATE_OVERRIDES` pins chosen rates, such as
  the bank's naira rate, on top.
- **WhatsApp notifications can be off.** `WHATSAPP_PROVIDER=none` skips the channel (logged as
  `channel_off`) and is accepted in production until each message has an approved template.
- **Owner check.** `pnpm --filter @suskii/api sandbox:messaging` and the manual
  `messaging-sandbox.yml` workflow read today's rates and send one test text per provider.

#### Changed

- A sign-in code that cannot be texted now answers 503 `sms-unavailable` and leaves no code or
  cooldown behind, so the traveller can retry at once.
- Terraform and Helm refuse plain settings ending in `_APP_ID` (secrets belong in Secret Manager).

### Company wallet (2026-10-28)

#### Added

- **Company wallet (ADR-090).** Company admins add funds by hosted checkout (limits per currency,
  five top-ups a day per company, `Idempotency-Key`); the wallet is credited only by the
  provider's verified webhook or by reconciliation, once, at the amount the provider charged
  (a different amount is audited). Bookers pay approved company trips from it in one step
  (`useCompanyWallet`), never with a payment plan; two trips paid at once cannot overdraw it
  (409 `company-wallet-insufficient`). Refunds of those trips go back to the wallet.
- **Who sees it.** Admins and approvers see balances, movements and top-ups on the website
  (Account, Company) through `GET /v1/me/company/wallet`; the booking's payment options say only
  whether the wallet covers the amount due. The console's company detail shows balances and the
  latest top-ups.
- **Checks.** The ledger reconciliation compares each top-up with its capture and the provider
  (`company_topup` discrepancies); the console dashboard counts company wallet payments and
  refunds with the other wallet money.
- **Clients.** Website: the Wallet card (add funds, return page that follows the top-up,
  history), "Pay from the company wallet" at checkout and on the booking page. App: the same
  choice at checkout and on the trip screen. Copy in all five languages.
- **Data.** `company_wallet_top_ups` (expand-only migration `20261111120000_company_wallet`),
  data registry entry, export to the requester, retention (90 days unpaid, the financial records
  period paid), settings `COMPANY_WALLET_TOPUP_LIMITS` and `COMPANY_WALLET_TOPUPS_PER_DAY`.

#### Fixed

- Two payments at once from one personal wallet answered 500 when the second found the balance
  spent; it now answers 409 `wallet-insufficient`.

### Compliance, part 2: rights requests, breaches and records of processing (2026-10-28)

#### Added

- **Deadlines per law (ADR-089).** `PRIVACY_RULES` in `@suskii/shared`: for Nigeria, Kenya, South
  Africa, the EU, the UK and elsewhere, the regulator, the breach notice period and the answer
  period for each kind of request, each marked as set by law or an internal target, with its
  source. `privacyRequestDueAt()` and `breachNoticeDueAt()` compute every due time.
- **A register of data rights requests.** Self-service exports and deletions are recorded as they
  happen under the law of the caller's country; the privacy officer records requests received by
  email, phone, post or support in the console and completes them or refuses them with a reason.
  Open requests are listed by due time, overdue ones flagged.
- **A breach register.** A breach gets one regulator notice per law that applies, due 72 hours
  after awareness; each is recorded as sent (with the regulator's reference) or not required,
  and the breach closes only when none is pending. Details are encrypted and shown only on the
  breach.
- **A privacy officer role** (`privacy:manage`, with `users:read` and `audit:read`) and the
  console's Privacy registers page.
- **Alerts before a deadline passes:** `PrivacyBreachNoticeDue` pages 12 hours before a regulator
  notice is due (and after); `PrivacyRequestOverdue` opens a ticket. Runbook:
  `docs/runbooks/data-rights-requests.md`.
- **Records of processing and transfers**, generated from code (`pnpm --filter @suskii/api
  privacy:records`): 15 activities with purpose, lawful basis, people, data, tables and
  retention, and 17 recipients with what they receive, where they process it and the transfer
  basis (`docs/privacy/records-of-processing.md`). A test fails when a table holding personal
  data has no activity or the page is stale.

#### Fixed

- The metasearch link tamper test could leave the token unchanged about once in 64 runs.

### Compliance, part 1: payment pages and privacy obligations (2026-10-28)

#### Security

- **Payment pages run only our scripts (ADR-089, PCI DSS SAQ A).** Checkout and the booking page
  (`isPaymentPage()`) get `script-src 'self' 'nonce-…' https://challenges.cloudflare.com`
  without `strict-dynamic` or ad hosts, so the browser refuses any other script. The Meta and
  TikTok tags never start there, and a document that already ran them reloads once on entering
  checkout. Browser checkout events wait for the next page with the tags; the Purchase still goes
  server-side.

#### Added

- `docs/compliance/pci-saq-a.md`: SAQ A eligibility, the script inventory of each payment page,
  what the owner files every year, and the changes that would end eligibility.
- `docs/compliance/privacy-obligations.md`: Nigeria (NDPA and GAID 2025), Kenya (DPA 2019 and its
  2021 regulations: access in 7 days, rectification and erasure in 14), South Africa (POPIA and
  its amended regulations) and GDPR for comparison, with sources and owner actions.
- `docs/runbooks/personal-data-breach.md`: contain, assess, and notify each regulator in time
  (72 hours for the NDPC, the ODPC and GDPR authorities; the Information Regulator's portal as
  soon as reasonably possible).

### Availability objectives and the status page (2026-10-28)

#### Added

- **Objectives and error budgets (ADR-087).** The API at 99.9% and the booking path (quotes,
  bookings, payments) at 99.5% of requests without a server error over 30 days. Recording rules
  keep the error ratio over five windows; multi-window burn-rate alerts page at 14.4x and 6x and
  open a ticket at 1x, only with enough traffic to judge. Promtool tests cover each case, and the
  new runbook (`slo-burn.md`) covers telling travellers.
- **Checks from outside.** Cloud Monitoring checks the website, `/ready` and `/v1/status` through
  Cloudflare every minute from three continents and alerts when one fails from two regions for
  two minutes (`uptime_alert_emails`, `uptime_notification_channels`). They still fire when the
  whole platform, and so every metric, is down.
- **Status page.** `GET /v1/status` reports search, bookings, payments, accounts and support,
  measured every 30 seconds (readiness, supplier circuit breakers across instances, paused
  payment providers, the ticketing wait) and made worse by what open incidents declare. It still
  answers when the database is down, and Cloudflare keeps the last good copy while the API does
  not answer. Never a supplier's name.
- **Incidents.** Operations and support staff (`status:manage`) open, update and resolve
  incidents in the console; every change is audited. The website shows `/status` (footer,
  sitemap) and a strip above the header on every page while one is open; the app shows the same
  banner on Home and Trips and a Status screen. Copy in all five languages.

### Accessibility audit, WCAG 2.2 AA (2026-10-28)

#### Added

- **WCAG 2.2 AA as the target (ADR-088)** for the website, the console and the app, with a
  conformance table for all 55 A and AA criteria (`docs/accessibility/wcag-2.2-aa.md`): how each
  is met, what checks it and what still needs a person.
- **A sweep of every public page** (`apps/web/e2e/a11y.spec.ts`, 72 tests in the web e2e run):
  axe with the WCAG 2.2 tags and targets of 24 px or more at 360 and 1280 px on 21 pages, reflow
  at 320 px, text spacing at the criterion's values, 44 px search controls, a focus indicator on
  every homepage tab stop, the sticky header never covering focus, and a flight search with the
  keyboard alone.
- **An accessibility guard for the app** (`apps/mobile/src/accessibility.test.ts`): every
  touchable has a role and a name, radios and checkboxes report `checked`, tabs `selected`, text
  inputs carry a label, and nothing turns off the system font size.

#### Fixed

- The deals page skipped a heading level (deal cards are `h2` there).
- The "watch this route" link and the sign-in and register helper links are at least 24 px tall.
- Focus moved by the keyboard, or an in-page link, stays clear of the sticky header.
- The app's support category and approval reason choices announce "checked", not "selected".
- The app follows the device's orientation instead of locking to portrait (WCAG 1.3.4).

### Expedia Rapid hotels (2026-10-28)

#### Added

- **Expedia Rapid hotel adapter (ADR-086).** `HOTEL_SUPPLIERS=expedia` adds Expedia's and Vrbo's
  inventory beside Duffel Stays and Hotelbeds, merged by the existing duplicate rule. A polygon
  around the city finds property ids, Expedia Collect rates are shopped for up to 250 of them
  and named from the content API (ids and content cached for a day). Prices come from the
  billable amounts in minor units, with taxes inside the total and property fees paid at the
  hotel. A price check runs before the quote and another before booking, which refuses a total
  that moved after payment. The booking call runs in `creating()`, so an unclear answer goes to
  review instead of a second itinerary.
- **Checkout IP for Expedia bookings.** Rapid requires the traveller's IP on its booking call,
  which runs after payment. The checkout IP is kept on Expedia items only, encrypted
  (`booking-item:{id}:customer-ip`), and cleared once booked, when ticketing gives up, at
  account deletion, or by the `supplier-customer-ip` retention rule after 7 days. The data
  export lists it while it is held.
- **Settings.** `EXPEDIA_RAPID_API_URL` (the sandbox host by default; production refuses it),
  `EXPEDIA_RAPID_API_KEY`, `EXPEDIA_RAPID_SHARED_SECRET`, `EXPEDIA_POINT_OF_SALE`,
  `EXPEDIA_REQUEST_CURRENCY`, `EXPEDIA_SEARCH_RADIUS_KM`, `EXPEDIA_MAX_PROPERTIES` and
  `EXPEDIA_RATES_PER_PROPERTY`.
- **Sandbox check.** `sandbox:partners --only expedia` and the `partner-sandbox.yml` workflow
  search and price-check through the adapter on Rapid's test host with the owner's keys.

### After-hours support assistant (2026-10-28)

#### Added

- **An instant answer when nobody is on shift (ADR-085).** Outside `SUPPORT_HOURS` (in
  `SUPPORT_TIME_ZONE`), a traveller who writes to support on the website, in the app or on
  WhatsApp gets an answer in seconds, drawn only from the published FAQs and, when the
  conversation is about one of their bookings, that booking's facts (status, places, local
  times, amounts, refundability, documents). Answers are labelled "Automated answer" and say a
  person will also read the message. Off unless `SUPPORT_ASSISTANT_ENABLED`.
- **It never acts and cannot make things up.** The model has no tools and returns a JSON
  object that is checked in code: it must cite the FAQs or facts it used, and every figure,
  link, email address or phone number in the answer must appear in what it cites. Anything
  else becomes a handover ("our team is offline; a person will reply here"), shown in the
  traveller's language. It never changes the conversation's status, priority, assignee or SLA
  times, stops after a handover, after three answers or once a person has replied, and runs
  under daily spend caps per conversation and overall.
- **Privacy.** The model sees the FAQs, the traveller's scrubbed words and a booking's facts
  without names, contact details, passport data, ticket numbers, codes or references, and no
  user, conversation or booking id. Nothing it receives or answers is logged.
- **Console.** Assistant answers show the FAQs and booking facts they cited, and a handover is
  marked.
- **Eval.** 40 conversations over 12 FAQs and 5 bookings (answers, handovers, prompt
  injection, requests for actions, private-data fishing, four languages), graded by rule: at
  least 90% must pass and no case where only a person may answer may be answered. CI runs it
  with recorded answers (including wrong ones the checks must stop); `ai-eval.yml` (suite
  `support-assistant`) runs it against the model.

### App requests on bad networks (2026-10-28)

#### Fixed

- **Reads no longer load forever.** The app's API transport had no timeout, so on a network
  that drops packets instead of refusing them a read could hang and leave a screen loading
  (the CI emulator's offline trip flow failed this way). Reads now give up after 20 s
  (`READ_TIMEOUT_MS`) and count as no network, so Trips and the trip screen fall back to the
  copies saved on the phone. Writes and uploads still wait as long as they need. Trips also loads
  the account's trips and the phone's guest trips side by side, so a bad network costs one
  timeout, not two in a row.

### WhatsApp support (2026-10-28)

#### Added

- **WhatsApp as a support channel (ADR-084).** Travellers write to the business number and the
  message lands in the same support inbox, with the same SLA timers, queues and audit. A signed
  Cloud API webhook (`/v1/webhooks/whatsapp`, checked against the app secret before anything is
  read) adds messages to the contact's open conversation, reopens one solved in the last
  `SUPPORT_WHATSAPP_REOPEN_DAYS` (7), or starts a new one. Repeated deliveries change nothing.
- **Replies.** Inside the 24-hour window, staff replies go out as WhatsApp messages. Outside it,
  the approved template (`WHATSAPP_SUPPORT_TEMPLATE`) goes as a notice, and the reply follows as
  soon as the traveller writes back. STOP turns templates off until they write again. Each reply
  shows Sending, Sent, Delivered, Read or Not delivered (with Meta's error code). Internal notes
  are never sent.
- **Console.** A channel filter, the contact's masked number, whether the window is open or why
  a reply cannot go (STOP, a username without a number), and a marker for photos and other
  attachments, which are recorded by type and never downloaded.
- **Privacy.** Numbers and business-scoped user ids are sealed and found by HMAC. Contacts are
  never linked to accounts automatically, because numbers get recycled. They are purged 30 days
  after their last message once no conversation is left.

#### Fixed

- **Meta Graph API version.** The Conversions API default moves from v24.0, which expired on
  6 October 2026, to v26.0.

### Supplier booking retries (2026-10-28)

#### Fixed

- **No second booking after an unclear supplier answer.** Ticketing used to retry a booking
  call that failed with a 5xx, a lost connection or an unreadable or unconfirmed answer, even
  when the supplier may already have booked. Hotelbeds and Duffel take no idempotency key, and
  Duffel flights search again before ordering, so a retry could buy a second stay or ticket.
  Those failures are now `SupplierAmbiguousError`: suppliers that dedupe on the idempotency key
  still retry, the others go to REFUND_PENDING for review (`unconfirmed_needs_review`), as a
  timeout already did. Failures before the booking call (a quote, a fresh offer) still retry.

### Support conversations (2026-10-28)

#### Added

- **Conversations tied to bookings (ADR-083).** Travellers, guests and visitors write to support
  from the website (`/support`, the header, the footer and every booking page) or the app
  (Account and every trip). A conversation can be about one booking the caller can open. Guests
  get a token once (kept in session storage or the phone's secure store), and reply emails carry
  a 30-day link. Without a session, the website needs Turnstile and the app its device
  attestation.
- **Priority and SLA timers.** Trips starting within `SUPPORT_URGENT_HOURS` (48) are urgent,
  Prime plans with priority support come next, then everyone else. `SUPPORT_SLA` sets a reply
  and a resolution target per priority. Due times are recomputed on every change and order the
  inbox.
- **Console inbox.** Staff with `support:manage` see queues (open, mine, unassigned, solved)
  with due and overdue marks. They can reply, add internal notes the traveller never sees,
  assign agents, and change priority, category or status. Every change is audited.
- **Notifications.** A staff reply notifies account holders by email and push (the new
  `support` category) and guests by email with an access link. No notice includes the reply
  itself.
- **Privacy.** Message bodies and guests' emails are encrypted per row. The data export includes
  conversations without internal notes or staff names, account deletion removes them, and
  solved ones are purged two years after their last change. The store forms now list in-app
  messages (Play) and customer support (App Store).

### Suskii Prime priced per country (2026-10-28)

#### Added

- **Country prices (ADR-082).** A Prime plan price may name a country (`USD 18 GH`); visitors
  from that country see and pay it, everyone else the currency's price for everywhere. The
  country is the edge's (`CLIENT_COUNTRY_HEADER`), never a value the client sends.
- **Quotes keep their price.** The membership quote records the country it was priced for, so
  the re-check before payment uses the same entry even if payment arrives through another edge
  location.
- **Website and console.** The Prime page and the homepage promo pass the visitor's edge country
  for displayed prices; the app needs no change. Console price lines take an optional country,
  and the plans table names country prices. The demo plan carries a Ghana price.

### Metasearch partners (2026-10-28)

#### Added

- **Partner price API (ADR-081).** `GET /v1/metasearch/flights` lets engines such as Google
  Flights, Skyscanner, KAYAK and Wego price our flights with a key in `X-Api-Key`. Answers list
  the cheapest itineraries first with every segment, baggage and fare conditions, the all-in
  total the website shows a guest, and a sealed deep link. Partner traffic shares the search
  cache and writes no search analytics row.
- **Keys and limits.** Staff with `pricing:manage` add partners in the console after a fresh
  authenticator check; the key (`smk_…`) is shown once and stored only as an HMAC, and replacing
  it stops the old one at once. Each partner has requests per minute and per day and a result
  cap; wrong keys are limited per address.
- **Landings.** `/flights/go/[token]` quotes the partner's itinerary again with the supplier. The
  same or a lower price goes straight to checkout; a higher one shows both totals first; a gone
  flight or a link older than `METASEARCH_LINK_TTL_HOURS` (24) offers the same search. Every
  landing is recorded with its outcome, and bookings made from its quote carry the partner.
- **Console report.** `Metasearch` lists partners with 30 days of landings by outcome, price
  accuracy, how often the flight was still there, and committed bookings with their value per
  currency.

### SEO pages from fare history (2026-10-28)

#### Added

- **Route facts (ADR-080).** Every deal refresh now keeps the cheapest fare it found per
  departure date (`route_fares`, 400 days). Route pages show what that history says: the typical
  return fare (90-day median), the lowest fare in 30 days with its date and airline, whether
  nonstop flights exist, the fastest journey, the cheapest month to fly and the airlines on the
  route. Facts are priced at read time with today's markup, tax and currency, say what each
  figure means, and appear only once `ROUTE_FACTS_MIN_DAYS` (3) days of fares exist.
- **Flight hubs and airline pages.** `/flights/from/[city]` and `/flights/to/[city]` list popular
  routes with their latest and typical fares; `/airlines/[code]` lists the routes an airline was
  seen on in 90 days with its own lowest fare. Route pages link to both hubs and every airline;
  pages without routes answer 404. All of them join the sitemap.
- API: `facts` on the route detail (additive), `GET /v1/deals/cities`, `/cities/{slug}`,
  `/airlines` and `/airlines/{code}`; the snapshot prune reports `deletedFares`.

### Ads with consent (2026-10-28)

#### Added

- **Meta and TikTok tags after consent (ADR-079).** With `META_PIXEL_ID` or `TIKTOK_PIXEL_ID` set,
  the website loads the networks' tags only after a visitor allows marketing cookies, now or later
  in the visit. Pages report PageView, Search (the vertical and airport codes), ViewContent,
  InitiateCheckout, Purchase (event id = booking id) and CompleteRegistration with trip facts
  only; automatic matching stays off. The CSP gains the networks' hosts only when configured.
- **First-visit prompt.** While a tag is configured, a fixed bottom bar asks once, with "Accept
  all" and "Reject all" of equal weight and "Choose" for the full list. A refusal loads and
  queues nothing. `COOKIE_POLICY_VERSION` is 2, so earlier choices are asked again. The cookie
  list names every cookie and storage key the tags set, in every language.
- **Server-side Purchase events.** A booking from a consented visit carries the consent id and
  the networks' click ids; the API keeps them only when the recorded choice for that consent id,
  under the current policy, allows marketing. A worker sweep (`AD_CONVERSION_SWEEP_MINUTES`)
  re-checks the consent, sends each paid booking's Purchase to the Meta Conversions API and the
  TikTok Events API (`AD_CONVERSIONS`) with SHA-256 of the contact email and phone, retries
  twice, and clears the click ids once settled. Rows go after 30 days and with the account, and
  appear in the data export.
- Settings in `.env.example`, Terraform and Helm (tokens as secrets); security documents and
  store forms (website only: the app has no ad SDK).

#### Changed

- **Homepage JavaScript.** The server reads the consent cookie per request, so the prompt and the
  tags load only when needed (nothing for a visitor who said no), and the header's signed-in
  check no longer pulls in the session refresh code. The homepage ships 173,815 bytes in 11
  scripts, 164 fewer than before, under the 170 kB budget.
- A cookie choice now stops ad events at once, even with the tags already loaded.

### Company accounts (2026-10-28)

#### Added

- **Companies and their people (ADR-078).** A signed-in traveller creates a company (name,
  country, optional registration and tax numbers, billing email) and becomes its admin. Admins
  invite people by email as admins, approvers, bookers or travellers; the link is single use,
  lasts 7 days and works only for an account whose verified email is the invited one. One
  company per person; the last admin cannot leave, step down or delete their account while
  others depend on them.
- **Travel policy.** A nightly hotel cap (in any supported currency), the highest flight cabin,
  a minimum number of days ahead, and when trips need an approver: never, outside the policy,
  or always. The API checks the policy from the quote when a member books with
  `company: true` and stores what it found on the booking.
- **Approval before payment.** A trip that needs an approver cannot be paid or put on a payment
  plan (409 `approval-required`) until an approver or admin approves it; rejecting (with a reason
  code) cancels the unpaid booking. Nobody decides their own trip. Approvers are told when a trip
  waits for them and the booker when it is decided.
- **Reports.** Company trips for admins and approvers (each booker sees their own), committed
  spend by month and by traveller in each currency, and a CSV of every trip without contact or
  passport details.
- **Website:** Account > Company (details, policy, members and invitations, approvals, trips,
  spend and the CSV), `/company/join` for invitation links, "Book for {company}" at checkout and
  the approval state on the booking page.
- **App:** Account > Company with trips to approve and company trips, "Book for {company}" at
  checkout and the approval state on the trip screen.
- **Console:** a Companies page (find, members, policy) where super admins suspend a company
  (step-up) and reinstate it; a suspended company cannot book for itself.
- API: `/v1/me/company` (create, read, update, policy, members, invitations, accept, roles,
  removal, bookings, approve, reject, spend, export) and `/v1/admin/companies` (list, detail,
  suspend, reinstate). Bookings carry an additive `company` section; `createBooking` takes an
  optional `company` flag.
- Privacy: memberships in the data export and deleted with the account; invitations stored as
  HMACs and purged 30 days after expiry; a `company_admin` deletion blocker.
- Tests: unit (policy facts, CSV), API e2e (roles, invitations, approvals, reports,
  suspension, IDOR matrix, admin audit), web e2e, admin e2e, app Jest.

### Verified reviews (2026-10-28)

#### Added

- **Reviews only from travellers who took the trip (ADR-077).** Each stay, package, tour, bus
  ride or rental of a confirmed booking can be reviewed once, from the day after the trip ends
  until `REVIEW_WINDOW_DAYS` (default 90) later, by the account that booked it or the holder of
  the guest link: a rating out of 10, an optional title, what was liked and what could be
  better, who the traveller went with, and their first name and last initial or "Verified
  traveller". Anyone else gets 404.
- **Moderation.** Every review waits for a moderator (`reviews:moderate`: content managers,
  support, super admins) who publishes it as written or rejects it with a reason; nobody edits a
  traveller's words. Contact details and links in the text are flagged. Publishing, rejecting,
  writing and withdrawing are audited; scores change in the same transaction.
- **Invitations.** A worker sweep (hourly, `REVIEW_INVITATION_SWEEP_MINUTES`) asks the morning
  after the trip ends, once: account holders through their notification preferences (new
  category "review requests"), guests by one email with a link to their booking.
- **Where reviews show.** Package, tour, rental and bus pages on the website (with JSON-LD
  ratings on indexed pages once a review is published), package and tour screens in the app,
  and a verified score on hotel results and the hotel page. Hotels match across suppliers by
  normalised name within 250 m, so a review follows the hotel whichever supplier lists it.
- **Writing a review** on the website's booking page and the app's trip screen, with the
  moderation status and a way to change it while it waits or withdraw it.
- **Console:** a Reviews page with the queue, the flags and the decisions.
- `GET /v1/reviews`, `GET /v1/bookings/{id}/reviews`, `PUT`/`DELETE
  /v1/bookings/{id}/items/{itemId}/review`, `/v1/admin/reviews` (list, publish, reject),
  `POST /v1/internal/reviews/invitations/run`; bus trips now carry the operator's id and hotel
  results `verifiedReviews` (both additive).
- Privacy: reviews are in the data export; account deletion removes unpublished reviews and
  keeps published ones without the account or name; rejected reviews are purged after 90 days
  and names go when a booking is anonymised.
- Tests: unit (eligibility, subjects, hotel matching), API e2e (who may review, moderation,
  invitations, the hotel score, the IDOR matrix and audit coverage), worker, web e2e (product
  page and the booking page form), app Jest (trip screen form, withdrawal, product reviews).

### Languages (2026-10-28)

#### Added

- **French, Swahili, Arabic and Portuguese (ADR-076).** The website and the app in `fr`, `sw`,
  `ar` and `pt`, with complete catalogs. Tests check that each keeps the English placeholders,
  has the plural forms its language needs (six in Arabic) and has no string left in English. The
  translations are drafts and need a native speaker's review before production.
- **Right to left in Arabic.** The website sets `<html dir="rtl">` and uses logical direction
  utilities only (a lint rule in the website and a guard test in ui-web refuse physical ones);
  arrows mirror, tabs follow the arrow keys' direction and the calendar runs right to left in the
  page's language. Inserted values (airport codes, prices, booking codes) are isolated so they
  never reorder an Arabic sentence. The app mirrors from the device language.
- **Latin digits in every language,** so prices, times and codes read as they do on tickets.
- **The visitor's language without asking.** The website uses the footer choice, else the
  browser's `Accept-Language`, else `en-NG`; the app follows the device's languages. The picker
  names each language in its own language.
- Web e2e: French from the browser (axe, every breakpoint, the footer choice wins), Arabic home
  and flight results (direction, Latin digits, axe, a phone's width) and the hydration check in
  Arabic.

#### Fixed

- ui-web's class merger read `inset-s-*` as the `inset` shorthand and dropped `inset-x-*` and
  `top-*` before it; it now knows the inline start and end families as tailwind-merge does.
- The footer's data saver select was wider than a phone in French, Swahili and Portuguese (up to
  113 px of overflow at 360 px); the preference controls now wrap and shrink.
- The calendar keeps DayPicker's own day labels on English pages and the "today" and "selected"
  parts of a day's label in every language (catalog templates `search.datePicker.today` and
  `selected`).
- The homepage stays within its 170 kB JavaScript budget (173,976 bytes gzip): locale negotiation
  is no longer shipped to browsers, and the class merger builds its repeated families.
- The mock checkout counts viewing and paying in separate per-IP buckets, so 15 test checkouts
  in ten minutes no longer exhaust it (development and test stacks only).

### Fast on slow 3G (2026-10-28)

#### Added

- **Search results in under 3 seconds on slow 3G (ADR-075).** From pressing Search on the
  homepage to the first fare on a throttled mid-range Android (400 kbit/s, 400 ms, 4x CPU): 8.4 s
  before, 2.1 s now (median of three). The web e2e `slow-3g` project runs the journey in CI and
  fails above 3 s.
- **One round trip per search.** The website and the app show the page the search answers with.
  `POST /v1/flights/searches` and `POST /v1/hotels/searches` take `limit` (1 to 50, default 20).
- **The search starts with the form.** The website's search forms start the search as they are
  submitted and the results page picks it up; the first four cards draw before the filters.
- **Compressed public answers.** The API compresses search, catalog and content reads (Brotli or
  gzip, `COMPRESSED_PATHS`), never answers that can hold a token or personal data.
- **Data saver.** A footer choice on the website (`__Host-suskii_data_saver`, else the browser's
  `Save-Data: on`) and a setting under Account in the app: 10 results per page, and city art
  instead of destination photos on the website.
- The website opens its connection to the API early (`preconnect`), and the tab icon is a 48 px
  PNG (2.7 kB instead of 60 kB); the install manifest has its own 512 px icon.

### Fixes (2026-10-28)

- Rentals: two bookings inserting overlapping periods of one car at the same moment could end in a
  Postgres deadlock, answered as 500; the loser now gets 409 `vehicle-unavailable`.

### Payment methods at checkout (2026-10-27)

#### Added

- **Choose how to pay (ADR-074).** Checkout lists methods instead of payment companies: card,
  bank transfer, USSD, mobile money, Apple Pay or Google Pay (`apple_google_pay`) and cash at a
  bank or POS agent (`agent`), with a short hint under the chosen one. Only the methods that work
  in the booking's currency are listed.
- **Methods per provider and currency.** `PaymentProvider.methodsFor(currency)`: Paystack takes
  transfers, USSD, agent payments and Apple Pay in naira and mobile money in cedis and shillings;
  Flutterwave the same without Apple Pay or Google Pay; Stripe cards with Apple Pay and Google
  Pay everywhere; the mock every method.
- **The provider's page opens on the chosen method** (Paystack `channels`, Flutterwave
  `payment_options`). Stripe Checkout requests 3D Secure whenever the card's bank or strong
  customer authentication requires it.
- **Routing by method.** `POST /v1/bookings/{id}/payments` takes `method`; the first provider in
  `PAYMENT_PROVIDERS` order that takes it is charged, and 422 `payment-method-unavailable`
  answers a method no enabled provider takes. `payment.created` audits the method.

#### Changed

- `PaymentOptions` gains `methods` (additive). `providers` and the request's `provider` stay for
  older app builds, which keep working.

### Refund offer for airline changes (2026-10-27)

#### Added

- **Significant changes (ADR-073).** An airline change is significant when a flight is
  cancelled, moves to another airport, gains a connection, or moves by 3 hours within one country
  or 6 hours otherwise (`SIGNIFICANT_CHANGE_DOMESTIC_HOURS`,
  `SIGNIFICANT_CHANGE_INTERNATIONAL_HOURS`). It is decided when the change is found and stored on
  the change.
- **One-tap full refund.** The booking's `scheduleChange.refundOffer` offers everything the
  traveller paid. `POST /v1/bookings/{id}/schedule-changes/{changeId}/refund`
  (`Idempotency-Key`) cancels with the airline first. Only when the airline's refund covers what
  we paid it does the whole balance go back to the original payments, with no fee. A short or
  refused airline refund withdraws the offer to support with an operations alert
  (`airline.refund_offer_blocked`); a supplier outage answers 503 and keeps the offer.
- **Email, website and app.** The change email names both choices. The booking page and the trip
  screen show "Cancel and get {amount} back" beside "Accept new times", behind a confirmation.
- Audit action `booking.schedule_change_refunded`. The mock airline refunds a declined change in
  full (`involuntaryRefundBps` for tests).

#### Changed

- `FlightScheduleChange` gains `significant` and `refundOffer` (additive). Older app builds keep
  the accept button and the support note.
- A change that cannot be accepted online but carries a refund offer no longer alerts operations
  on detection: the traveller can resolve it alone.

### All-in prices and tax rules per country (2026-10-27)

#### Added

- **Tax table (ADR-072).** `tax_rules` holds tax on Suskii's own service per country: code,
  label, rate in basis points, basis (`margin`: our markup and fees less any promo; `full`: fare
  and fees less any promo, for products sold as principal), an optional vertical, validity dates
  and the registration number. The rules of `TAX_SELLER_COUNTRY` (default `NG`) are applied;
  rules for other countries can be prepared in advance. Nothing is seeded: the rates come from
  the owner's accountant.
- **All-in totals.** Each matching rule adds a `serviceTaxes` line to every price (search
  results, deals, quotes, bookings), and `total` includes it, so the first price a customer sees
  is the price they pay. Supplier taxes are never taxed again. With no rule, every price is
  unchanged.
- **Admin API and console.** `GET`, `POST` and `PATCH /v1/admin/pricing/taxes` (`pricing:manage`,
  step-up, audited as `pricing.tax_created` / `pricing.tax_updated`) and a Taxes section on the
  pricing page. A `full` rule reaching buses, rides or rentals is refused (409
  `tax-overlaps-cars-vat`) while `CARS_VAT_BPS` already puts VAT in Cars fares.
- **Receipts.** E-tickets, vouchers and passes print each tax line with its rate and the
  registration number, from the booking's stored price, so a receipt never changes with a rule.
- **Website and app.** Checkout shows each tax line inside the total. The app's hotel results and
  checkout now say when city tax is paid at the hotel, as the website already did.
- `TAX_SELLER_COUNTRY` in `.env.example`, the Terraform examples and the Helm values.

#### Changed

- `Price` gains `serviceTaxes` (additive, empty by default). Older app builds ignore it and show
  the same total, which already includes the tax.

### Partner sandbox check (2026-10-27)

#### Added

- **`partner-sandbox.yml` and `sandbox:partners`.** A manual, read-only check that calls
  Hotelbeds' evaluation host, Viator's Partner API and the Travelpayouts Partner Links API through
  our adapters with the owner's secrets, and prints real hotels with their cheapest stays and a
  rate check, tours with prices, and which affiliate programmes got a tracked link. A partner
  without keys is named and skipped; the run fails at its first step when none is set. CI never
  calls a partner.

### Partner offers on the website and in the app (2026-10-27)

#### Added

- **Booking page and trip screen.** Trips that are going ahead show "More for your trip": an
  airport transfer, a car, an eSIM, insurance and priced tours for the destination and dates, from
  `GET /v1/bookings/{id}/partner-offers`. Each opens the partner's site through the API's tracked
  link (a new tab on the website, the system browser in the app), and the card says the traveller
  books and pays with the partner and that Suskii may earn a commission.
- **Cars hub.** The website's `/cars` and the app's Cars screen list car rental and airport
  transfers from partners. The website hub no longer answers 404 while only partner offers are on.
- Copy in `@suskii/i18n` (`partners`); Jest tests in the app, Playwright checks on the booking
  page and the hub (tracked link redirects to the partner), and a Maestro check on the trip.

#### Security

- `docs/security/dependency-exceptions.md` lists the four moderate and low advisories still open in
  mobile and build tooling (none in production code paths reachable by users; CI's high and
  critical gate passes).

### Partner supply: Hotelbeds, affiliate offers and commission tracking (2026-10-27)

Research and decisions in `docs/research/partner-supply.md`, ADR-069 (supply model), ADR-070
(tracking) and ADR-071 (Hotelbeds). Suskii sells like an online travel agency: merchant supply
where partners sell net rates, affiliate links where they pay commission. No driver KYC and no
vetting of third parties; the own ride-hailing and fleet stay switched off in production.

#### Added

- **Hotelbeds as a second hotel supplier** (`HOTEL_SUPPLIERS=hotelbeds`, ADR-071): availability
  by geolocation, rate checks before payment and bookings through APItude, with signed requests
  and error mapping to the supplier errors. Production refuses the evaluation host.
- **One listing per hotel across suppliers.** When two hotel suppliers return the same hotel
  (normalised name within 250 m), the search keeps the cheaper one.
- **Partner offers** (ADR-069): `GET /v1/partners/offers` for a place and
  `GET /v1/bookings/{id}/partner-offers` for a booked trip list car rental (DiscoverCars,
  Localrent, Economybookings), transfers (GetTransfer, Kiwitaxi), eSIMs (Airalo), insurance (EKTA)
  and priced tours (Viator Partner API). The traveller books on the partner's site.
- **Tracked links and clicks** (ADR-070): every offer links to `/v1/go/{token}`, an AES-GCM sealed
  token that only leads to the partner's own hosts. The redirect records a `partner_clicks` row
  (ids only) and adds the network's tracking (Travelpayouts Partner Links API, cached per page,
  with an untracked fallback so no click is lost).
- **Conversions** from network postbacks (`/v1/partners/postbacks/travelpayouts`, secret in the
  URL, compared in constant time): pending, confirmed or cancelled, moving forward only, amounts
  in minor units.
- **Commission report** for staff with `reports:read`: `GET /v1/admin/partners/summary`.
- Settings `PARTNER_OFFERS_ENABLED` (off in production unless set), `AFFILIATE_NETWORK`,
  `TRAVELPAYOUTS_*`, `ACTIVITY_PARTNER`, `VIATOR_*`, `PARTNER_TIMEOUT_MS` and
  `PARTNER_LINK_TTL_HOURS`; production refuses mock partners while offers are on.

#### Privacy

- Clicks appear in the account's data export (activity), lose their user id at account deletion
  and are purged after 13 months (`partner-clicks`). Conversions hold no personal data and are
  kept for the financial period (`partner-conversions`). Store privacy forms updated
  (`docs/release/data-safety.md`).

### Sign-in buttons in the app (2026-10-27)

#### Fixed

- **Google and Apple were hard to find in the app.** They sat below the email form, under the
  main button, and disappeared whenever the app could not ask the API which providers it offers
  (a stopped test server, a slow first request). They now sit at the top of Sign in and Register.
  Only the API's own answer hides them. While that answer is unknown, both show, and a press asks
  again and says when the server cannot be reached.
- **No fingerprint button on a fresh install.** Sign in showed "Sign in with fingerprint" only
  once a credential existed on the phone. It now always shows. Until fingerprint sign-in is on,
  a press says how to turn it on: sign in once, then choose Use fingerprint. A phone without a
  fingerprint is told to add one in its settings. Register says fingerprint sign-in can be turned
  on once the account is ready.
- **Phone test.** `e2e/maestro/sign-in.yaml` signs up with Google (mock provider), signs out,
  checks the fingerprint button and its hint, and signs in again with Google into the same
  account. It runs last in `run-android.sh`.

### SUSKII T&T redesign, phone testing and sign-in (2026-10-27)

#### Added

- **Hosted test server (ADR-066).** `test-server.yml` runs the e2e stack on a GitHub runner for up
  to 5.5 hours behind one Cloudflare quick tunnel.
  - The stack is the API, website, worker and demo drivers, with mock suppliers and payments.
  - The address goes into `test-server.json` on the `test-server` pre-release.
  - A single-origin proxy (`scripts/test-server-proxy.mjs`) serves the API, the website and the
    ride WebSocket on one address.
  - Demo drivers take the rider's PIN on `/demo-drivers` when no terminal is attached.
- **The test app finds it.** The test APK reads the address file at launch and uses that server.
  The address is remembered for an offline start until it expires. A server chosen under Test
  server still wins.
  - When the server cannot be reached, the banner offers to start it, and Try again looks for the
    file again.
- **Sign in after registering (ADR-067).** A new account signs straight in on the website and in
  the app. An email that already had an account says so.
- **Google and Apple sign-in.** "Continue with Google" and "Continue with Apple" appear on the
  website and in the app when the API offers them (`GET /v1/auth/social/providers`).
  - The website redirects to the provider and reads the ID token on `/sign-in/callback`.
  - The app uses the system Apple sheet on an iPhone. Otherwise it goes through `/sign-in/app`
    in the system browser, with a nonce bound to a secret only the app holds (`binding` and
    `bindingSecret`).
  - Test stacks use the mock provider (`SOCIAL_MOCK_ENABLED`, refused in production): the button
    asks which email to sign in as.
- **Fingerprint sign-in in the app.**
  - **Offer.** Shown once after signing in, and switchable under Account.
  - **API.** `POST /v1/me/device-credentials` (within 10 minutes of signing in, five phones at
    most), `POST /v1/auth/device`, `GET` and `DELETE /v1/me/device-credentials`.
  - **Storage.** The secret stays in the secure store behind the biometric prompt; the API keeps
    an HMAC.
  - **Lifetime.** Credentials end with every session of the account. New table
    `device_credentials`, with a 30-day retention rule for revoked rows.

#### Changed

- **Redesign from the logo (ADR-068).**
  - **Colours.** Tokens and `PROJECT_SPEC.json` take the logo's red for actions (`#D11F0E`), its
    blue for headings (`#0B3FBF`), the cart tile's orange for promotions (`#F7A21B`) and a warm
    white background. The contrast contract still passes.
  - **Assets.** The logo is the app icon, adaptive icon and splash, and the website and console
    icon. `scripts/brand-assets.mjs` builds them from `brand/suskii-tt-logo.webp`.
  - **Name.** The app is called SUSKII T&T, the brand short name is SUSKII T&T, and the website
    header and the app's Home show the logo.

#### Fixed

- **Manage booking.** The link in the website header and footer led to a missing page. It now
  opens a form that emails the booking link to the booking's contact address when the reference
  and email match (`POST /v1/bookings/link`, always 202; guests get a fresh access link valid for
  a day).
- **After registering on the website.** When the automatic sign-in was refused for a reason other
  than the password (too many attempts, a second factor), the page claimed the email already had
  an account. It now says the account is ready and to sign in.
- **MFA after Google or Apple.** A traveller with MFA who signed in with Google or Apple on the
  website, or registered in the app with an account that has MFA, lost the second-factor step.
  It now continues on the page.
- **Pickers open.** The date, traveller, room and filter pickers in the app now open: the sheet
  uses React Native's own modal instead of `@gorhom/bottom-sheet`, which never presented on some
  phones.
- **Place search.** Place fields say when places could not load instead of "No matching airports
  or cities", and ask for a pick from the list instead of "This field is required".

### Airline schedule changes (2026-10-26)

#### Added

- **Schedule change checks (ADR-065).** Ticketed flights whose supplier reports airline changes
  (Duffel, the mock) are checked every `SCHEDULE_CHANGE_CHECK_HOURS` (6) until the trip has left.
  - The worker's one-minute booking sweep calls `POST /v1/internal/bookings/schedule-changes-due`,
    at most `SCHEDULE_CHANGE_BATCH_SIZE` (10) orders a run.
  - Each new change is stored in `flight_schedule_changes` and audited.
  - The traveller is emailed and pushed the old and new times. Operations are alerted when the
    change cannot be accepted online, or when the airline cancelled or changed the order
    elsewhere.
- **Accept online.** `POST /v1/bookings/{id}/schedule-changes/{changeId}/accept` accepts with the
  supplier first and is safe to repeat. Once nothing waits for the traveller, the booking's
  flights follow the airline's and the e-ticket is rendered again.
- **Website and app.** An open change shows as a banner with the booked and new times side by
  side and "Accept new times", or a note that support will be in touch. Bookings carry
  `scheduleChange` (additive; older app builds ignore it).
- **Suppliers.** `FlightSupplier` gains `tracksChanges`, `orderChanges()` and
  `acceptAirlineChange()`. Duffel reads the order once per check
  (`GET /air/orders/{id}`). The mock moves the first flight of orders on routes in
  `MOCK_SCHEDULE_CHANGE_RULES`.
- **Sandbox.** The sandbox check reads its paid order back through `orderChanges()` and fails if
  the flights differ from the booked offer.
- **Metric.** `suskii.schedule_change.checks` counts checks by outcome.

#### Changed

- The migration adds `booking_items.next_change_check_at` and makes flights ticketed before this
  release due for a check at once. The first sweeps stop checking those that have flown.

### Online cancellation of ticketed flights (2026-10-26)

#### Added

- **Cancel a ticketed flight online (ADR-064).** Bookings show `flightCancellable` for a ticketed
  flight whose supplier cancels online (Duffel, the mock) before departure.
  - `POST /v1/bookings/{id}/cancellation-quote` opens the airline's pending cancellation and
    holds the traveller's refund for the quote's life (at most 30 minutes).
  - The refund is the traveller's share of what they paid, in the proportion the airline refunds
    what we paid it, rounded down.
  - `POST /v1/bookings/{id}/cancel`, with the quoted `refund`, cancels with the airline first,
    then refunds through the ledger and refund pipeline, keeping the rest as a cancellation fee.
  - Credits, other currencies, departed flights and lapsing quotes go to support (409
    `not-cancellable`).
- **Supplier order ids.** Ticketing keeps the supplier's order id, and suppliers gain
  `cancellationQuote()` and `confirmCancellation()`. The Duffel confirmation re-checks its
  state after a failure, so a retry is safe.
- **Website and app.** "Cancel flight" shows the refund, what is kept and until when the offer
  stands, then cancels with that exact refund.
- **Sandbox.** The sandbox check cancels its paid order through the quote and confirm, and the
  journey books, pays and cancels through our API. Against Duffel's test mode the order was
  cancelled with a full refund, and the booking moved to `REFUND_PENDING`.

### Checked bags on Duffel flights (2026-10-26)

#### Added

- **Duffel bags.** Duffel flights sell checked bags (ADR-063).
  - The quote and the payment re-check fetch the offer with Duffel's services.
  - One passenger's bag is the set of services of one weight that covers every segment once.
  - A weight is sold when every passenger with a seat can add it at the same price.
  - Booking re-reads the services and refuses a bag that is gone or changed price. It pays the
    fare plus the bags from the balance.
- **Bag picker in the app.** Each traveller with a seat can add bags, as on the website. The
  summary shows the extra baggage and the new total, and reserving or installments are switched
  off while bags are chosen.
- **Sandbox.** The sandbox check lists the bags Duffel offers and books its order with one bag.
  The journey books a flight with a bag through our API. Against Duffel's test mode, both
  succeeded and the booking ended `CONFIRMED` with one extra bag.

#### Changed

- A flight quote gets twice `SUPPLIER_TIMEOUT_MS`. A Duffel quote searches again, then loads the
  offer's extras.

### Duffel sandbox check (2026-10-26)

#### Fixed

- **Two travellers can book the same Duffel flight from one cached search.** Duffel takes one
  order per offer request, so the second order used to fail after payment (and was refunded).
  `FlightSupplier.quoteOffer()` now picks the offer each quote books from. The Duffel adapter
  searches again and quotes the same flights and fare from a fresh offer request: the same total
  first, then the cheapest match, else `offer-unavailable`. Other suppliers still re-check the
  searched offer. The sandbox journey books two travellers from one shared search; both ended
  `CONFIRMED` against Duffel's test mode (ADR-062).

#### Added

- **Flights and the app journey.**
  - The sandbox check also covers Duffel flights: search, re-check and error codes, and with
    `book` a paid order and a hold, both then cancelled. The workflow's `only` input picks
    flights or hotels.
  - The workflow's `journey` input runs `test/sandbox/duffel-journey.sandbox-spec.ts`
    (`test:sandbox`). That is our API, as the website and the app call it, against Duffel's test
    mode: search, quote, guest booking, mock payment, then Duffel's confirmed order or stay.
  - The local stack (`e2e:stack`) switches to Duffel's test mode for phone and browser testing
    with `E2E_FLIGHT_SUPPLIERS` / `E2E_HOTEL_SUPPLIERS=duffel`, taking a test token only (README).
- **Results against Duffel's test mode** (ADR-062):
  - Flights work end to end. Search, re-check, a paid order, a hold and cancellation all
    succeeded, and the API journey ended `CONFIRMED` with an airline reference and an e-ticket.
  - Duffel takes one order per offer request. Our shared search cache could therefore make a
    second traveller's order fail after payment (fixed above).
  - Stays answers 403 until it is enabled on the account.
- **Error pages.** `DuffelClient` maps a non-JSON error page by its HTTP status (a 403 is a
  request error), rather than reporting invalid JSON.
- **`duffel-sandbox.yml`**, a manual workflow, and `pnpm --filter @suskii/api sandbox:duffel`.
  They put the open questions of ADR-062 to Duffel's test mode and print what Duffel answers:
  - whether search results carry rooms;
  - the radius unit;
  - which rates we can sell;
  - the fields and lifetime of a quote;
  - the error codes for unknown ids, and how our client classifies them;
  - with `book`, a booking through the adapter, a repeated booking on one quote, then
    cancellations.
- The check uses the `DUFFEL_API_TOKEN` repository secret and refuses anything but a
  `duffel_test_` token. It sends only made-up guest details. CI still never calls Duffel.

### Duffel Stays hotel adapter (2026-10-26)

Design and open checks in ADR-062. Built from the types in Duffel's official SDK; every test runs
against fixtures or a local fake server, and nothing has called Duffel yet.

#### Added

- **`DuffelHotelSupplier`** behind `HOTEL_SUPPLIERS=duffel` (needs `DUFFEL_API_TOKEN` and Stays on
  the Duffel account). It covers search around the city's coordinates, every rate of a hotel
  (`fetch_all_rates`), quotes and bookings paid from the Duffel balance.
  - Only rates paid in full now from the balance are sold. Pay-at-hotel, deposit and loyalty-only
    rates are left out.
  - Boards, free-cancellation deadlines, taxes and fees are mapped to our types, and amounts are
    parsed without floats.
  - A booking quotes the rate again and refuses a price that moved after payment. An ambiguous
    failure goes to review, because Stays takes no idempotency key.
- **Two-step hotel rates.** A supplier whose search returns only each hotel's cheapest price sets
  `ratesComplete: false` and implements `HotelSupplier.rates()`.
  - The hotel page loads the full list once per search. It is kept beside the results in Redis,
    and the first writer wins.
  - When the supplier cannot answer, the page shows the search rates instead.
  - Full-list rate ids end in `.f<n>`. The quote route accepts them beside `.r<n>`; both
    generated API files were regenerated.
- Tests:
  - unit tests on SDK-shaped fixtures;
  - an API e2e suite against a local fake Duffel server: search, full rates loaded once, quotes,
    sold out, and the fallback;
  - env schema cases for `HOTEL_SUPPLIERS=duffel`.

#### Changed

- The production Terraform example sets `HOTEL_SUPPLIERS = "duffel"`. Hotels no longer appear in
  the list of mock-only providers that block production.
- `external-communications.md` and the release privacy answers name Duffel as a hotel supplier and
  list what it receives.

### Phase 13: AI trip search (2026-10-25)

Plan and outcome in `docs/phases/phase-13.md`; design in ADR-061. Optional and behind a flag
(on outside production, off in production unless set). Nothing calls a real model yet: the
95%-accuracy eval against the model waits for the owner's `LLM_API_KEY`.

#### Added

- **"Describe your trip"** on the flight search of the website and the app: a "Describe your trip
  instead" button above the form opens the box (on the website its code loads only then). A message such as "Lagos to
  London next Friday, 2 adults, back a week later" fills the flight form; the traveller checks
  it and searches as usual. A filled form names what is still missing; every failure keeps the
  text and points to the form.
- **API:** `POST /v1/flights/natural-search` and `GET /v1/flights/natural-search` (status).
  - An `LlmProvider` interface. `AnthropicLlmProvider` uses the official SDK (pinned 1.1.0),
    Claude Haiku 5.5 by default (`LLM_MODEL`), structured output against a JSON schema, effort
    `low`, a cached system prompt, an 8 s timeout, one retry and no redirects.
    `MockLlmProvider` (deterministic, offline) is refused in production unless
    `ALLOW_MOCK_PROVIDERS`.
  - Before the call, `scrubQuery()` removes e-mail addresses, phone numbers and long digit runs.
    The text is never stored or logged.
  - The model's answer is validated again with Zod. Places resolve through our catalog; dates
    and travellers go through the form's rules. Problems become `missing` fields, not errors.
  - `AiSearchBudget` reserves each call's worst case in Redis against daily caps per user or
    guest address (`AI_SEARCH_USER_DAILY_MICROUSD`, $0.05) and in total
    (`AI_SEARCH_GLOBAL_DAILY_MICROUSD`, $20), then settles to the billed tokens. Over a cap:
    429 `ai-search-budget-exceeded`.
  - Rate limits: 10 a minute and 200 a day per IP, 20 a minute per user.
  - Other answers: 422 `ai-search-not-understood`, 503 `ai-search-unavailable`, 404 while off.
  - Metrics: requests by outcome, duration, cost and tokens.
- **Evals:** 50 messages with their expected forms (`test/fixtures/natural-search-eval.json`).
  - The e2e test runs them through the whole pipeline with recorded model answers (50/50).
  - `pnpm --filter @suskii/api eval:natural-search` runs them against the configured model,
    printing mismatches, accuracy, tokens and cost; it fails below 95%.
  - The manual **AI search eval** workflow (`ai-eval.yml`) runs it with the `LLM_API_KEY`
    secret.
- **Shared:** natural-search schemas, with the constants in `@suskii/shared/lite`. **i18n:**
  `search.describe` copy and a `month` date style.
- **Settings:** `AI_SEARCH_ENABLED`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS`,
  the per-token prices and the two caps. They are in `.env.example`, the Terraform examples
  (staging on the mock model, production commented) and the Helm notes.
- **Docs:** external communications (the model provider), data classification, business limits,
  crypto inventory, threat model, access control, logging inventory and the app privacy forms
  (described trips go to the model provider once and are not stored).

#### Changed

- Homepage JavaScript: 169.1 kB to 169.5 kB (the button that opens the box).

#### Fixed

- App: the airport fields kept showing their old text after the swap button (or any change made
  outside the field). The native `Combobox` now follows its selection without overwriting what
  the traveller types.

### Phase 12: deployment and release (2026-10-25)

Plan in `docs/phases/phase-12.md`; decisions in ADR-057 to ADR-060. Everything up to the owner's
accounts is built and rehearsed; nothing has been deployed (no GCP project, Cloudflare zone,
Expo or store account exists yet).

#### Added

- **Container images** for the API (with a separate `migrate` target), worker, website and
  console: pinned Node base by digest, pruned workspaces, production dependencies only, non-root,
  read-only file systems, health checks, OCI labels and `SENTRY_RELEASE` from the commit
  (ADR-058).
- **Release rehearsal** (`pnpm release:rehearse`, compose). It deploys release N as production
  does (migrations as the schema owner, the API as a row-only role), smoke-tests it (8 checks),
  runs the first-super-admin ops command, refuses a broken N+1 at the health gate, rolls back and
  smoke-tests again. Passes locally.
- **Terraform** for GCP and Cloudflare (`infra/terraform`, ADR-059):
  - Cloud Run for the four services plus `migrate` and `ops` jobs;
  - Cloud SQL for PostgreSQL 16 (private, PITR) and Memorystore for Redis 7.2 (AUTH, TLS with
    server authentication);
  - a private documents bucket, Artifact Registry with immutable tags, and Secret Manager with
    per-service readers and audit-logged reads;
  - Workload Identity Federation for GitHub;
  - a global load balancer reachable only from this zone's Cloudflare traffic (Cloud Armor:
    Cloudflare ranges plus an origin secret);
  - port-level egress firewall and fixed NAT addresses;
  - the Cloudflare edge: strict TLS, settings that leave HTML untouched, managed WAF,
    internal-route and console address rules, a sign-in rate limit, https-only API.
- **Optional Helm chart** (`infra/helm/suskii`): migration hook, readiness-gated rolling
  updates, `--atomic` rollback, hardened pods, default-deny network policies. Also
  `scripts/helm-rehearsal.mjs` for kind, and the AWS mapping in `docs/deployment/aws.md`.
- **Pipelines** (ADR-060):
  - `deploy.yml`: staging on every green main.
  - `release.yml`: `v*` tags to staging, then production after approval, with a 10% canary for
    10 minutes, a 5xx gate in Cloud Monitoring (`scripts/canary-check.mjs`) and smoke tests.
    Images are built once, scanned by Trivy, signed with cosign, attested with an SBOM, and
    promoted by digest. Automatic rollback to the previous revisions.
  - `infra.yml`: Terraform fmt, validate and TFLint; Helm lint and kubeconform; both rehearsals.
  - `mobile-release.yml`: submits `mobile-v*` builds to TestFlight and the Play internal track,
    and publishes EAS Updates of the scanned bundle.
- **S3-compatible object storage** (`OBJECT_STORAGE=s3`, ADR-057): one SigV4 adapter for GCS,
  S3 and R2, no SDK, e2e-tested against a signature-checking gateway.
- **`staff:bootstrap`**: the only way to create the first super admin of a new environment.
  It refuses once one exists, is audited, and an advisory lock lets one of two concurrent runs
  win.
- **`CLIENT_IP_HEADER`** (`cf-connecting-ip` behind Cloudflare): client addresses from the edge's
  header instead of counting proxy hops. A forged `X-Forwarded-For` is ignored.
- **`REDIS_TLS_CA`** for managed Redis server certificates (API and worker), and
  **`DATABASE_POOL_MAX`**.
- **Migration guard** (`scripts/check-migrations.mjs`, in CI): expand/contract only, unless a
  migration says why on an `-- expand-contract:` line.
- **Store listing checklist and privacy form answers** (`docs/release/`), and the deploy and
  rollback runbook (`docs/runbooks/deploy-and-rollback.md`).

#### Changed

- **Separate database roles.** The release step creates the API's role, which may only read and
  write rows. Its password is set as a SCRAM verifier, and the step checks the role holds nothing
  more (e2e-tested). Migrations run as the schema owner from the migrate job only.
- **Pool size.** Prisma's pool is sized by `DATABASE_POOL_MAX`; node-postgres ignored the
  `connection_limit` URL parameter the docs relied on.
- **Security mapping.** It closes the 17 requirements left for deployment: 15 met, 2 partial
  with an owner decision each (visitor cipher allowlist, name-based egress).

#### Fixed

- The API image's OCI labels were applied only to its migrate stage.

### Cars: buses, rides and car rental (2026-10-24)

Task `suskii-cars-v1` (`docs/phases/cars.md`, ADR-049 to ADR-053). Every product and feature is
behind a `CARS_*_ENABLED` flag (on by default outside production) and reported by
`GET /v1/cars/features`, so clients hide what is off.

#### Added

- Interstate buses: operators, terminals, routes, seat layouts and trips (admin); search, seat
  map and 10-minute all-or-nothing seat holds in Redis; guest or account checkout; one
  Ed25519-signed QR boarding pass per seat (`SUSKII-T1`, no personal data) with a PDF; operator
  agents board each ticket once, see manifests and sync offline scans.
- Intrastate rides: curated pick-up places and city fare rules; upfront fares (OSRM or a
  straight-line fallback); paid bookings create the ride; dispatch with offers and timeouts; an
  audited ride state machine; rider PIN to start; live tracking over WebSocket (Redis pub/sub)
  with REST polling as the fallback; share links; SOS that texts emergency contacts; PIN lockout
  and route deviation incidents; ratings; cancellation fees under the accepted terms.
- Drivers: applications with NIN and licence (encrypted, KYC adapter), documents (sealed per
  file, antivirus), vehicles, staff review, online and offline, offers, earnings in the ledger and
  payouts (mock provider) with reconciliation.
- Car rental: fleet per branch city; availability enforced by a database exclusion constraint
  with a turnaround buffer; refundable deposit, chauffeur and delivery options; licence checks
  for self-drive; immutable handover records with condition photos; deposit release with
  deductions.
- Website: `/cars`, `/buses`, `/rides`, `/rentals`, live ride and shared trip pages, Cars
  checkout and booking views, boarding passes drawn from the signed payload.
- Console: Buses, Drivers, Rides and safety, Rental desk and Finance sections.
- App: Cars hub, bus search and seat map, QR passes on the trip screen (offline), ride request
  and live ride, rental search and booking, licence upload, driver mode and ticket scanning with
  the camera (`expo-camera`).
- P9 features: the fare by its parts (`priceBreakdown` on quotes and bookings, additive),
  the departure planner (`GET /v1/bookings/{id}/departure-plan`), trip suggestions
  (`GET /v1/bookings/{id}/cars-suggestions`, prefilled searches only), route deviation
  incidents, and offline boarding on operator phones (`@noble/curves` Ed25519, queued scans).
- Privacy and operations: `docs/privacy/cars-data-map.md`; Cars metrics, a dashboard row and
  alerts (SOS, unacknowledged incidents, stalled dispatch, document backlog, unscanned
  departures, payouts); runbooks for safety incidents, stuck rides, the document backlog, an
  offline scanner and webhook replay.
- Whole-platform audit: `docs/audits/e2e-audit.md`.

- Demo drivers for local ride testing (ADR-056): `pnpm --filter @suskii/api rides:demo`, or
  `E2E_DEMO_DRIVERS=true` on `e2e:stack`. The sample drivers come online near each waiting ride,
  accept it, drive to the pick-up and along the route, and complete it, through the driver
  services; you type the PIN from the rider's app. Production refuses it. The e2e stack now
  shares one set of throwaway keys between the seed, the API and the simulator.

#### Changed

- The website's currency and locale selectors post to `/preferences/{name}` (a route handler)
  instead of Server Actions.
- The API refuses compressed request bodies (415).
- `/favicon.ico` redirects to `/icon.svg` on the website and the console.
- zod 4.6.7, nodemailer 10.1.7, vite 8.3.x and vitest 5.0.5; overrides for handlebars, undici,
  fast-uri and the lint plugin's zod.

#### Fixed

- The app no longer hides Cars when it cannot reach the API. Home has a Cars search tab (bus,
  ride and rental buttons) next to the Cars card; when the server is unreachable, Home and the
  Cars hub list the products with a retry card instead of hiding them or loading forever, and
  the test build points to Account, Test server. Driver mode and ticket scanning still wait for
  the API to confirm they are on.
- body-parser 2.4.0 (GHSA-27r3-jxmh-p828) and multer 2.5.0 (GHSA-q7qp-rjg7-q26m) through
  overrides, installed once both passed the release cooldown; `pnpm audit` has no open high
  advisory.
- Booking pages and the data export no longer fail on a stored price without a fare.
- A late driver location fix no longer moves the driver back in time or fails the speed check.
- Model years show without a thousands separator.
- The app reaches the API again on devices: the retired-version hook returned the response,
  which openapi-fetch refuses from Expo's fetch, so every call failed (since phase 11).
- Ride cancellation fees and driver earnings are converted at the booking's own exchange rate,
  and drivers earn their share of the metered fare only (not of VAT or service fees).
- Ride PIN guesses are checked one at a time, and a ride handed back after a lockout can be
  started by the next driver.
- A driver suspended mid-trip keeps sending positions until the ride ends; a driver whose offer
  lapses stops receiving the ride's live updates.
- Each rental licence upload is its own file, so a running scan cannot approve a newer upload.
- Offline boarding scans are held to the server clock (no future times, at most 48 hours old).
- Boarding passes are rendered on every read and never stored; a bus booking cannot be cancelled
  after departure or once a passenger boarded; payment closes 30 minutes before departure.
- A rental's reservation deposit follows an accepted re-price, and the deposit-release refund is
  no longer recorded as cancelling the booking.
- The Expo CLI and Lighthouse's chromium-bidi get a fixed zod (scoped overrides).
- Next.js 16.4.1 (web, console) and Storybook 10.6.3, fixing two critical and two high
  advisories. The trust policy stays as it is: semver 6 users (Babel 7, two ESLint plugins,
  istanbul) move to semver 7.8.5 instead of admitting `semver@6.3.1`, which has no provenance.
- App: a session the API revokes now also clears the account's trips, booking copies, saved
  documents and scanning keys from the phone, and sign-out removes booking copies and documents
  opened from links or notifications; a refresh that answers after sign-out or a new sign-in is
  dropped.
- A website session refresh that fails for an outage no longer clears the session cookies.
- Result filters and sort respond at once on slow devices instead of snapping back until the
  URL update lands.
- The API reports its verdict on a device attestation (`X-Suskii-Attestation-Result`); the iOS app
  treats its App Attest key as attested only once the API accepted it, and replaces a key it never
  confirmed or later rejected.
- The Android end-to-end run also books a sample tour as a guest and checks the voucher.
- Refunds settled by hand that had never reached their provider now move the money out of the
  booking first (or credit the wallet), instead of failing or borrowing another refund's
  in-flight money; an interrupted wallet refund is credited by the sweep, never sent to the card
  provider.
- App: offline boarding scans name the agent who made them, upload only under that agent and
  survive a sign-out without signal (48 hours); the encrypted cache opens once on a cold start
  with a deep link; a failed start retries instead of leaving a blank screen; turning on
  notifications offline shows a message instead of failing silently; only real transport
  failures count as offline.

### Phase 11: Hardening (2026-10-12)

#### Added

- Accounts and sessions (ADR-037, ADR-038):
  - Passwords are refused when common (9,126-entry list), breached (Have I Been Pwned range
    API) or built on context words or the account's own details.
  - Recovery codes are stored with argon2id.
  - Changing the phone, enrolling MFA and signing out other devices need a fresh proof.
  - Sessions are capped (10 per traveller, 3 per staff member); staff sessions last at most 12
    hours, with a 30-minute idle limit.
  - The riskiest admin actions need step-up; `sessions:revoke` signs accounts out in bulk for
    incidents.
  - Google and Apple sign-in need a single-use nonce issued by the API.
  - Field encryption keys have ids, previous keys stay readable, and `keys:reencrypt` rewrites
    ciphertexts under the new key.
  - Production refuses plaintext Postgres, Redis and worker-to-API connections.
  - Phone sign-in warns that texted codes can be intercepted.
- Privacy (ADR-039, ADR-042):
  - Every table has a retention rule, and a daily sweep purges what is past its period.
  - Cookie settings record each choice through the API before any optional category runs; a
    catalog lists every cookie and storage key, and an e2e test fails on anything unlisted.
  - Guest booking tokens are forgotten on sign-out and account deletion.
- Payment risk review (ADR-040): captured card payments are scored. At or above the threshold
  the booking stays PAID and waits in a finance queue (approve, or reject with a full refund).
- Old app versions (ADR-041): `MOBILE_MIN_VERSION` makes the API refuse older builds, and the app
  shows an update screen.
- Supply chain and security CI (`.github/workflows/security.yml`,
  `docs/security/dependency-exceptions.md`):
  - gitleaks, `pnpm audit`, Trivy and Semgrep, with pinned, checksum-verified tools;
  - a CycloneDX SBOM;
  - overrides for vulnerable transitive packages;
  - release cooldowns and trust guards in pnpm;
  - a passive OWASP ZAP scan of the e2e stack, triaged in `docs/security/zap-baseline.md`.
- Tests:
  - an object-level authorisation matrix over every owned-resource route;
  - 80% coverage gates on money, pricing, lifecycle and auth;
  - screenshot tests for key ui-web components;
  - a k6 load test of catalog reads and the booking journey in CI (ADR-045).
- Performance (ADR-043, ADR-044):
  - The homepage ships 168.5 kB of JavaScript under a 170 kB budget. Shared code compiles from
    source, ui-web uses native tabs, segmented control and combobox, and `cn` no longer needs
    tailwind-merge.
  - The Lighthouse gate checks LCP, CLS and TBT.
  - The website reports field Core Web Vitals to `POST /v1/telemetry/web-vitals` (text/plain
    beacons, sampled), recorded as metrics by page template and device.
- Error reporting (ADR-046): API, worker, website, console and app report unexpected errors to
  Sentry, with scrubbed messages and allowlisted tags only. Request ids join the website, the API
  and the worker.
- Metrics and alerts (ADR-047):
  - business counters (quotes, bookings, transitions, webhooks, payments, ticketing, refunds);
  - operational gauges (bookings in flight, oldest ticketing wait, open refunds and risk reviews,
    database connections);
  - worker queue and job metrics;
  - three Grafana dashboards and 19 Prometheus alert rules, checked by promtool in CI and by a
    test that every metric, and every paging alert's runbook, exists.
- Security documentation (`docs/security/`): threat model (STRIDE for authentication, payments,
  bookings and documents), authentication and sessions, access control, cryptography inventory
  and key policy, data classification, logging inventory, external communications, business
  limits and heavy functions. `SECURITY.md` covers disclosure and remediation time frames.
- Security checklist (ADR-048): every ASVS 5.0.0 level 1 and 2 requirement and every MASVS
  control, mapped with status and evidence in `docs/security/standards/mapping.json`.
  `pnpm security:checklist` generates `docs/security/checklist.md`; CI checks that the mapping
  is complete, the evidence paths exist and the page is current.
- Runbooks (`docs/runbooks/`): payment provider outage, supplier outage, ticketing backlog,
  database restore (rehearsed locally with `pg_dump` and `pg_restore`), key rotation, session
  revocation and account recovery, and a manual VoiceOver and TalkBack checklist.
- `PAYMENT_PROVIDERS_PAUSED`: stops new payments through a failing provider while its webhooks,
  reconciliation and refunds keep working.

#### Changed

- Log redaction covers the top level and three levels below of every log object; the worker
  uses the same field list as the API (`SENSITIVE_LOG_FIELDS`). 403 and 429 responses log at
  `warn`, and non-admin authorization denials are logged.
- Production also requires TLS for the Duffel API, the OTLP collector (unless on localhost) and
  SMTP (STARTTLS when not implicit TLS). The Sentry sender refuses redirects and times out
  after 5 seconds.
- The website's own cookies are named `__Host-suskii_currency`, `__Host-suskii_locale` and
  `__Host-suskii_consent` in production.

#### Security

- Next.js 16.3.8 (GHSA-cjq9-62q9-8jv4, SSRF in image optimisation). `eslint-config-next` stays
  at 16.3.6: pnpm's trust policy refuses a dependency of 16.3.8 that lost its provenance.

#### Fixed

- Every form has a method, so a submit before hydration can no longer put personal data in
  the URL (a lint rule enforces it).
- Every problem response is described in the OpenAPI document.
- AES-GCM requires full-length authentication tags.
- A just-confirmed booking keeps polling until its documents exist (web and app).

### Phase 10: Admin console (2026-10-06)

#### Added

- Staff sessions (ADR-033): the console signs staff in through the existing auth routes
  (password, then the authenticator); a staff account without TOTP enrols before it gets a
  console session. Cookie-authenticated `/v1/admin` calls must come from an `ADMIN_ORIGINS`
  origin for every method (required and https in production, and listed in `CORS_ORIGINS`), so a
  script on the public website cannot use a staff member's session.
- Admin API (ADR-035, ADR-036): booking search (reference, status, vertical, dates, contact email
  through its HMAC) and detail with items, payment attempts, refunds, plan and status timeline,
  encrypted internal notes, an audited contact reveal and confirmation resend; user search,
  disable and enable (sessions revoked, the last super admin protected) and MFA reset; markup and
  fee rules, promo codes (the code is locked after the first redemption), deal routes and
  destinations; CMS blocks validated against the public site's schemas, FAQs and trust signals
  (an edit clears verification; verifying needs `trust-signals:verify` and an https evidence
  URL); a read-only dashboard with bookings by status and vertical, money taken and refunded per
  currency from the ledger, work queues, new accounts, active Prime members and top routes.
  Catalog products list their editable fields. Migrations add `booking_notes` and reporting
  indexes.
- Permission and audit metadata (ADR-034): contracts declare the audit actions an admin mutation
  records; the OpenAPI document carries `x-admin-permissions` and `x-audit`, and its build fails
  when a `/v1/admin` route has no permission or an admin mutation no audit action.
- Admin console (`apps/admin`): staff sign-in with MFA and enrolment (QR code drawn on the page,
  setup key, recovery codes), single-flight session refresh with a Web Lock, CSRF on writes and
  a nonce CSP. Navigation shows only the sections the roles allow, and a section mounts only for
  staff who may open it. Pages: dashboard, bookings (search, detail, notes, contact reveal,
  refund requests), refunds (approve or reject under maker-checker, resolve), vouchers, users
  (roles, disable, MFA reset), audit log, markups and fees, promo codes, deal routes and
  destinations, CMS blocks and FAQs, trust signals (verify with evidence), the in-house catalog
  (packages, tours, add-ons, visa products, departures), visa applications (documents through
  signed links, status changes, comments) and eligibility rules, Suskii Prime plans and the
  referral review queue. Copy comes from `@suskii/i18n/admin`.
- Tests: API e2e route matrix over every admin operation in the OpenAPI document (anonymous,
  customer, staff without the permission, staff without MFA, foreign or missing origin, and the
  permitted caller); an audit coverage suite that performs every admin mutation and checks its
  declared entries; behaviour suites for the new routes. Admin Playwright journeys: enrolment on
  first sign-in, a refused code and sign-out, a customer turned away, a refund requested by
  support and approved by finance, a markup raising a public price, a trust signal verified and
  served publicly, a promo code created, the audit log showing each change with its author, and
  axe on every page and at phone width. CI runs the admin suite after the web suite.

#### Fixed

- Saving an unchanged CMS block no longer reports a change (jsonb reorders keys; content is now
  compared canonically).

### Phase 9: Accounts, Suskii Prime, referrals and notifications (2026-10-05)

#### Added

- Data rights (ADR-029): a registry gives every database model an export section and a deletion
  treatment, and a test fails when a model is missing. `POST /v1/me/data-export` returns one JSON
  document after re-authentication (password, a texted code or a recent sign-in, plus MFA).
  `GET/POST /v1/me/deletion` lists blockers (trips, payments, refunds, visa work, wallet
  balance, staff roles), then anonymises the account: profile, identities, sessions, factors,
  travellers, tokens, preferences, alerts and referral codes go; bookings, payments, refunds and
  ledger entries stay as financial records without contact details or passport numbers
  (`FINANCIAL_RECORDS_RETENTION_YEARS`). Deleted accounts can never be emailed.
- Account preferences and notification settings (`/v1/me/preferences`,
  `/v1/me/notification-preferences`): language, currency, home airport, marketing consent with
  its source, and a category-by-channel matrix in which booking and payment email cannot be
  turned off.
- Suskii Prime (ADR-030): plans per currency managed at `/v1/admin/prime/plans`
  (`pricing:manage`, audited; none in production, a sample plan in `db:seed:demo`); public
  `GET /v1/prime/plans` and `GET /v1/me/prime`. A membership is the in-house item `membership`
  (vertical `prime`) on the one booking pipeline; confirmation starts or extends the term.
  Members price as tier `prime`: a share of the markup back (never below supplier cost) and
  waived fees by code, shown as `memberSaving`. The tier travels in the access token and is
  re-read from the database for quotes, bookings and the payment re-check.
- Referrals (ADR-031): a code per account, attribution at registration or phone sign-up,
  qualification on the referee's first completed trip, then wallet credits through the ledger
  (`referral_reward`, `expense:promotions`). Rewards default to zero. Fraud signals (an alias of
  the referrer's email, the referrer's own network, a network or device shared with other recent
  referrals, disposable email domains, the monthly cap) send a referral to staff review
  (`/v1/admin/referrals`) instead of paying it.
- Notifications (ADR-032): `NotificationService` sends by category over email, SMS, WhatsApp
  (new `WhatsAppProvider`, mock adapter) and push as each account allows, and logs every attempt
  with a skip reason. New: check-in reminders, Prime expiry reminders, referral reward messages.
- Price alerts (ADR-032): `GET/POST/DELETE /v1/me/price-alerts` (up to 10, a date or a month,
  optional target); the worker sweeps them through `/internal/price-alerts/run`, pricing for the
  owner (Prime included) and notifying on a drop at most once a day. Worker sweeps for alerts,
  reminders and referrals.
- Web: sign-in (email and password, phone code, MFA), registration with a referral code, email
  verification, password reset and the account area (profile, notifications, trips, travellers,
  password, authenticator MFA with recovery codes, devices, Prime, invitations, price alerts,
  wallet, your data with export and deletion). Cookie sessions send the CSRF token on writes and
  refresh once across tabs with a Web Lock. `/prime` with live plan prices and joining through
  the normal checkout; booking pages show the membership term; "Watch this route" on flight
  results; Sign in / Account in the header; the homepage Prime block shows live prices.
- Mobile: phone-code sign-in next to email, an invite code on registration (prefilled from a
  `?ref=` link), the account hub with profile, notifications, devices, invitations (system share
  sheet), price alerts and your data (export through the share sheet with the cache copy deleted,
  in-app account deletion). The Prime tab shows plans, the member's term and joining with the
  hosted payment; trip screens show the membership; "Watch this route" on flight results.
  Notification taps can open Prime, the account, alerts and invitations.
- Tests: API unit tests for Prime pricing (including a property test that members never pay
  below supplier cost), the notification matrix, referral rules and alert triggers; API e2e for
  accounts, export and deletion, Prime purchase and member prices, notifications, alerts,
  referrals and reminders; web Playwright for registration, sign-in, notifications, Prime
  purchase, export and deletion; mobile Jest for sign-in, account screens, Prime, invitations,
  alerts and the membership trip (105 tests).

#### Changed

- Prime purchases are left out of the Trips lists; the Prime screens show them.
- The ui-native `ToastProvider` clears pending dismiss timers on unmount; `Card` takes a
  `testID`.

#### Not built yet

- Card fingerprints for referral checks (providers do not report them to us yet), saved payment
  methods and automatic renewal (stored-card mandates, ADR-018), Google and Apple sign-in buttons
  (owner OAuth client ids), the admin screens (phase 10) and schedule-change notices (supplier
  order webhooks).

### Phase 8: Packages, tours, visa and add-ons (2026-10-05)

#### Added

- In-house catalog (ADR-025): packages and tours with dated departures, capacity, per-person
  prices by traveller type, itineraries, inclusions and cancellation tiers; add-ons (insurance,
  airport transfers, eSIM, lounge) priced per person, booking or day; visa assistance products
  with document checklists; visa eligibility rules. Public list and detail routes, admin CRUD and
  publishing (`catalog:manage`, audited) and `POST /v1/inhouse-quotes`. Production starts empty;
  `db:seed:demo` (refused in production) adds sample inventory with a "Sample" badge.
- One booking pipeline for every vertical: in-house items reuse quotes, bookings, payments,
  the ledger, payment plans and refunds. Seats are reserved at booking with a conditional update
  (no overselling), sold at confirmation and released on expiry, failure or cancellation; the
  price is re-checked against the catalog before payment; packages can be reserved or paid in
  installments until the balance-due date (`PACKAGE_BALANCE_DUE_DAYS`).
- Fulfilment in the confirming transaction (ADR-028): voucher codes (no look-alike characters,
  stored hashed and encrypted) with QR codes on the PDFs and a one-time redemption route for
  operations; visa applications per applicant. Self-service cancellation under the policy tiers
  (fee to the ledger, automatic refund of the tier's share).
- Visa assistance (ADR-026): eligibility answers from the rules table (`unknown` without a rule,
  never a guess); one application per applicant with checklist uploads sniffed by content,
  size-limited, encrypted with per-document keys wrapped by `FieldEncryption`, virus-scanned
  (ClamAV adapter, `docker compose --profile av`; mock in development) and readable only
  through five-minute HMAC-signed links for the owner or a visa officer, every link and access
  audited; officer routes for review, requests, decisions and messages; visa update emails;
  document retention. Worker jobs rescan missed uploads and delete expired documents.
- Add-ons (ADR-027) standalone or linked to a trip, found from the booking page or by reference
  and last name (short-lived HMAC link tokens); transfer details encrypted per booking item.
- Web: `/packages` and `/tours` with results or popular products, detail pages with dates,
  traveller picker and policy; `/visa` with the eligibility answer and products, `/visa/[slug]`
  with the checklist and booking form; `/travel-add-ons` standalone, for a booking or by
  reference; checkout and booking pages for every vertical (voucher, cancellation, visa
  applications, extras); the visa application page with uploads, scan status, signed views and
  submission. Homepage teaser with real from-prices; non-sample products in the sitemap.
- Mobile: packages and tours on Home, lists and detail pages, checkout for in-house quotes, trip
  screens for every vertical with the voucher QR code drawn offline, cancellation under the
  policy, visa applications with uploads from the document picker, and extras for a trip.
- `@suskii/shared`: cancellation tiers and refunds, per-person totals, add-on units, voucher codes,
  document sniffing, in-house checkout facts and traveller drafts. `@suskii/i18n`: country names
  (`format.country`) and the copy for every new page, PDF and email.
- Tests: API unit and e2e for every vertical, the seat race, cancellation, signed document
  access and scanning; web Playwright journeys for packages, tours with linked add-ons,
  standalone add-ons and visa assistance; mobile Jest for the catalog, checkout, trips, visa
  uploads and extras (80 tests).

#### Changed

- Checkout asks for passports only where the product needs them (abroad, visa applicants);
  hold and installment wording follows the product.
- The app loads the formatjs `DisplayNames` polyfill for country names on Hermes.
- `next dev` no longer writes its own agent guides (`agentRules: false`).

### Phase 7: Mobile app (2026-09-30)

#### Added

- Expo app (`apps/mobile`, Expo Router, typed routes) on the shared API client, schemas, design
  tokens and copy (ADR-020): Home, Trips, Deals, Prime and Account tabs; flight search (one way,
  return, multi-city) and hotel search; results with FlashList, sort and filters, price-change
  and expiry handling; hotel rooms; checkout with travellers, passports, contact details,
  terms, payment plan and method; trip details with status polling, plan payments, refunds and
  documents; email sign-in with MFA and registration. The Prime tab previews the membership
  without prices.
- Payments open the provider's hosted page in the system browser (Custom Tabs or
  ASWebAuthenticationSession, never a WebView) and return through
  `WEB_APP_URL/mobile/payment-return`, which hands control back to the app (ADR-021). Webhooks
  stay the source of truth; the trip screen polls.
- Offline: trips and booking copies in an AES-256 MMKV cache keyed from the secure store,
  e-tickets and vouchers saved to app-private storage and opened through the share sheet. Tokens
  and guest booking tokens live in the Keychain / Keystore; Android backups are off. Sensitive
  screens block screenshots, blur the iOS app switcher and clear passport numbers after five
  minutes in the background.
- Deep links through an allowlist (`+native-intent`): emailed booking links (the `#access=` token
  goes to the secure store, never the router), search links re-validated with the shared
  schemas, app-scheme paths; everything else opens Home. App links and associated domains for
  the https website host.
- API: `GET /v1/me/bookings` (trip summaries, cursor pages); push tokens per account session or
  booking with Expo and mock providers and reference-only lock-screen text (ADR-022); single-use
  attestation challenges, the `X-Suskii-Attestation` header, a verifier interface with a mock
  adapter, attestation as the mobile guest bot check, and `ATTESTATION_MODE` (off, report,
  enforce) for mobile login, registration and payment start (ADR-023).
- Web: `/.well-known/assetlinks.json` and `apple-app-site-association` from environment values,
  and the app's payment return page. Worker: daily push token pruning.
- App variants (development, preview, production, e2e) in `app.config.ts`, EAS profiles with
  named environments and fingerprint runtime versions, and the EAS release workflow (on demand,
  and production for `mobile-v*` tags) gated on the owner's Expo account (ADR-024).
- Bundle secret scanner (`apps/mobile/scripts/scan-bundle.mjs`) with a planted-secret self-test,
  run on the exported bundle in CI, on the release APK (with Gitleaks) and the iOS app in the
  mobile workflow, and before EAS builds.
- Mobile workflow: Android release APK driven through the Maestro critical path (search, guest
  checkout with mock attestation enforced, hosted payment, confirmed trip, e-ticket saved, then
  opened offline) on an API 34 emulator against the e2e stack; unsigned iOS simulator build.
- Tests: 63 mobile Jest tests (link allowlist, attestation headers, single-flight refresh and the
  401 retry, trip storage, payment outcomes, home, checkout, trip and trips screens), shared
  checkout-draft tests, API unit and e2e tests for trips, push tokens and attestation, and web
  e2e for the association files and the return page.

#### Changed

- The checkout draft, its client-side checks and itinerary facts moved from the web app to
  `@suskii/shared` so the web and the app validate the same way.
- The ui-native `Combobox` takes a `testID` for its field and suggestions.
- The app loads `Intl` polyfills (formatjs `PluralRules`, `RelativeTimeFormat`, `ListFormat`,
  `Locale`, with en, en-GB and en-NG data) before any other module, because Hermes lacks them
  and the translator failed at start-up; `@suskii/i18n` formats date ranges without
  `formatRange` where the engine has none.
- The mobile app depends on `@babel/plugin-transform-react-jsx` directly: NativeWind's Babel
  preset names it without depending on it, and Babel resolves it from the app's
  `babel.config.js`, so the Android release bundle failed on a clean install.
- `.env.example` documents the mobile build settings and the app-link values.

### Phase 6: Payments, flexible payment and refunds (2026-09-30)

#### Added

- Payment providers behind one interface (ADR-016): Paystack, Flutterwave (v3) and Stripe
  Checkout, all hosted (SAQ-A), plus the mock provider. `PAYMENT_PROVIDERS` enables several at
  once, in preference order; the checkout offers those that settle the booking currency. Webhook
  signatures are checked over the raw body (HMAC-SHA512, `verif-hash`, `t=,v1=` with a 5-minute
  tolerance), Paystack and Flutterwave outcomes are confirmed server to server before they count,
  and pending payments whose webhook never arrived are reconciled with the provider.
- Double-entry ledger (ADR-017): accounts for the provider, each booking, unapplied money, wallets,
  refunds in flight and kept fees. The database enforces append-only entries, balanced
  transactions per currency at commit and non-negative customer balances; every posting is
  idempotent by a business key. `GET /v1/me/wallet` shows the balance and history.
- Reserve now, pay later and installments for flights (ADR-018): `POST /v1/bookings/{id}/hold` and
  `/installment-plan`, offered only when the airline hold (and, for installments, the price
  guarantee) covers the whole plan and never with paid extras. Deposit, equal installments,
  optional fee and a missed-payment policy (refund minus a basis-point fee); reminders 3 days and
  1 day before each due date by email and SMS with an expiring access link; defaults after the
  grace period; unpaid holds released at the deadline; at most two active holds per traveller.
  Mock supplier holds and Duffel `pay_later` orders (`air/payments`, order cancellations).
- Refunds (ADR-019): automatic refunds for money a booking cannot take, failed ticketing and plan
  defaults or cancellations; staff refunds through the admin API (`/v1/admin/refunds`: request,
  approve, reject, resolve) with maker-checker above `REFUND_APPROVAL_THRESHOLD_NGN` (default:
  always). Refunds go to the original method or the wallet, never exceed what was paid, settle by
  webhook or polling, and ambiguous calls to providers without idempotency keys go to review
  instead of being re-sent. Customers and operations (`OPS_ALERT_EMAIL`) are notified.
- Payments from the wallet (whole amount, one transaction), payment start with `provider`,
  `installmentId`, `payInFull` and `useWallet`, and payment options on quotes and bookings.
- Worker: payment reconciliation, plan reminders and defaults, and refund execution every minute.
- Web: checkout offers pay now, reserve and pay later, or installments with the full schedule, fee,
  total and missed-payment policy before commitment, and a payment method choice when several
  providers take the currency. The booking page shows the plan, pays the next installment or the
  rest, pays from the wallet, cancels under the plan's policy, lists refunds and their state, and
  opens from emailed links (the token in the URL fragment moves to session storage).
- Shared: installment schedule and refund policy maths with property tests; plan, provider and
  refund constants.
- Tests: provider signatures, payload mapping and amounts; ledger invariants (balanced,
  idempotent, non-negative under concurrency, append-only); the grown state machine matrix; API
  e2e for the three acceptance criteria, Paystack end to end against a fake server, lost webhooks,
  holds, installments with reminders, defaults, cancellation refunds, hold limits, maker-checker
  and wallet refunds; Playwright for reserve-and-pay-later and installments to a refunded
  cancellation.

#### Changed

- `PAYMENT_PROVIDERS` (list) replaces `PAYMENT_PROVIDER`.
- A success for the wrong amount, or money arriving for a booking that cannot take it, is refunded
  automatically instead of only being flagged; exhausted ticketing ends REFUNDED once the refund
  settles.
- State machine: `partial_payment` from HELD, `default` (PARTIALLY_PAID to REFUND_PENDING) and
  `cancel` from PARTIALLY_PAID.
- The booking page shows the total price and, separately, what has been paid.

#### Fixed

- The web error boundary imported the whole message catalog, which shipped with every page; it
  now receives only its own copy from the root layout (homepage JavaScript 216.7 kB to 200.9 kB
  gzip) and follows the visitor's locale.

### Phase 5: Flight and hotel booking flow (2026-09-29)

#### Added

- Web booking flow on live API data. Flight and hotel results with filters and sort in the URL
  (stops, airlines, departure time, price, journey time, refundable, checked bag; stars, rating,
  free cancellation, amenities, area, meals), facets with prices, load more, fare details with
  layover warnings and conditions, and expired-results recovery; a hotel page with every rate,
  board, cancellation terms and charges paid at the hotel.
- Checkout: travellers with a passport-form name preview, passports (required abroad), extra
  bags, contact details, promo code, terms consent and Turnstile for guests. The price is checked
  with the supplier right before payment; a change opens a consent dialog with the previous and
  new totals and the difference.
- Mock payment provider with a hosted page on the web app and HMAC-signed webhooks through the
  real webhook pipeline; booking page that polls until confirmed, then shows the itinerary or
  stay, ticket numbers or confirmation number, price paid and PDF downloads.
- API: `POST /v1/bookings` (idempotent), `GET /v1/bookings/{id}` (owner or `X-Booking-Token`, 404
  otherwise), payments with the price re-check (409 `price-changed`), price consent, cancel,
  document download, `GET /v1/quotes/{id}`, payment webhooks, mock checkout endpoints, saved
  travellers (`/v1/me/travellers`) and worker routes for expiry and ticketing (ADR-014, ADR-015).
- Booking state machine with the spec's 13 statuses; every transition is guarded, recorded in
  `booking_status_history` and audited in the same transaction (all state x event pairs tested).
- Migration 4: bookings, items, passengers, status history (append-only), saved travellers,
  payments, webhook events and documents. Contact details and passport numbers are encrypted with
  record-bound contexts and only returned masked; guest access tokens are stored as HMACs.
- Supplier booking: `book()` for flights (mock, Duffel orders) and hotels (mock), idempotent by
  booking item id, extra baggage services on mock offers. Ticketing retries transient failures
  with backoff (1, 2, 4, 8, 16 minutes) and moves exhausted or ambiguous cases to REFUND_PENDING.
- E-ticket and hotel voucher PDFs (pdf-lib, QR code of the reference) in private object storage
  (filesystem adapter for development) and the confirmation email with the PDF attached.
- Worker: a bookings queue expires unpaid bookings and runs due ticketing attempts every minute.
- Shared: passenger and contact schemas, transliteration of accented names, age and passport
  rules against the itinerary, booking constants.
- Tests: state machine matrix, passenger rules, PDFs, mock payment signatures, Duffel orders,
  worker jobs; API e2e for full flight and hotel flows, price consent, webhooks (signature,
  duplicates, amount mismatch, refund flags), ownership, idempotency, retries, exhaustion and
  expiry; Playwright for search to confirmation, the price-change consent path, hotels to voucher
  and phone layouts, all axe-checked.

#### Changed

- Stored idempotent responses are encrypted, since they can carry a guest booking token.
- `MOCK_REPRICE_RULES` apply once, at the re-price right before payment.
- Hotel results gain an area filter and facet; hotel quotes keep the supplier query.
- The generated API client keeps defaulted request fields optional.
- Checkout, payment and booking pages are noindex and disallowed in robots.txt.

#### Fixed

- Pre-filled search pages (flights, hotels, packages, tours, visa) no longer fail hydration when
  the browser's ICU/CLDR data formats dates differently from Node's: field values and select
  labels keep the server's text, and the packages month list starts from the UTC month until
  hydrated. A Playwright test alters the browser's `Intl` output to guard every such page.

### Phase 4: Web homepage (2026-09-29)

#### Added

- Web homepage with every section of the spec in order, on live API data: hero with verified trust
  bar, search card, trust strip, fresh flight offers (origin chips, carousel on mobile, grid on
  desktop, each card a pre-filled search), top hotel destinations with "from" prices, Suskii Prime,
  flexible payment, packages and tours, why book with us, app download, deal alerts, FAQ and
  popular routes and destinations.
- Search card with six tabs. Flights: round trip, one way and multi-city (2-5 legs), airport
  autocomplete (edge-cached popular index with API fallback, recent places), swap, date range
  (two months on desktop, full-screen on mobile), travellers, cabin, direct only, flexible dates,
  last search restored. Hotels, packages, tours, visa and add-ons are validated forms that route to
  their pages. All forms use the shared Zod schemas and serialise to shareable URLs; the add-ons
  booking mode keeps the last name out of the URL.
- Pages: vertical landing pages, flight and hotel search entry pages (noindex, ready for phase 5
  results), programmatic `/flights/{origin}-to-{destination}` and `/hotels/{city}` pages, `/deals`,
  CMS info pages, newsletter confirm and unsubscribe, a helpful 404 and an error page.
- SEO: per-page metadata and canonical URLs, Open Graph and Twitter images, JSON-LD
  (TravelAgency, WebSite, FAQPage, BreadcrumbList), sitemap from the API's routes and destinations,
  robots.txt, web manifest and icons. Card illustrations served as cached SVG images from `/art`.
- Nonce-based CSP per request (`proxy.ts`) with `strict-dynamic`, HSTS, nosniff, frame and
  referrer policies (ADR-010). Currency and locale preferences in functional cookies.
- `@suskii/i18n`: typed catalogs (en-NG, en-GB, en-US), plural-aware translator and `Intl`
  formatters shared by web and, later, mobile.
- `@suskii/shared`: search URL serialisation for flights and hotels, form schemas for packages,
  tours, visa and add-ons, and a Zod-free `@suskii/shared/lite` entry for browser rendering.
- API: homepage content (`/v1/content/site`, `/home`, `/pages/{slug}`; verified trust signals and
  published blocks only), flight deals and routes, hotel destinations, city lookup, token-guarded
  internal refresh routes, and double opt-in deal alerts with Turnstile (ADR-011, ADR-012).
  Migration 3 adds deal routes and snapshots, destination content and snapshots, and newsletter
  subscriptions; the seed adds 22 starter routes and 9 destinations.
- Worker: BullMQ job schedulers refresh deals every 3 hours and destinations every 6 hours with
  retries, backoff and a rate limit, prune old snapshots daily; `refresh:once` for local setup.
- ui-web: filter chips, status badges on deal and destination cards, validation errors on the
  date and traveller pickers, `useDeferredOverlay` with lazily loaded popover and dialog panels.
- Web e2e suite (Playwright, 36 tests plus the Lighthouse gate) against the real API, worker and
  web builds: section order, trust guardrails, flight form validation, URL serialisation and
  persistence, multi-city, every tab's routing, deals filter and links, currency and locale,
  newsletter, 360/768/1024/1440 layouts with axe, metadata, JSON-LD, sitemap, robots, social
  images, `/art` input validation, CSP and security headers, the homepage JavaScript budget.
- Lighthouse script (median of three mobile runs, thresholds from the acceptance criteria) and a
  Tailwind class check that fails when a used utility generates no CSS.
- CI: Postgres and Redis service containers, web e2e and Lighthouse step, report artifacts, class
  check; the worker's BullMQ test now runs in CI.

#### Changed

- Homepage performance (ADR-013): schemas load on form interaction, overlays and the calendar on
  first open, only latin fonts are preloaded. JavaScript 328 kB to 202 kB gzip, Lighthouse
  performance 78 to 97 (median). The spec's 170 kB target is tracked for phase 11 behind a 210 kB
  ratchet.
- Shared code imports Zod as a namespace for tree shaking and runs it jitless in browsers, so the
  strict CSP reports no eval attempts.
- Mock hotel rates scale by country price level.

#### Fixed

- Hotel search reports malformed dates as validation issues instead of throwing.
- `cn()` merges container widths (`max-w-page` with `max-w-dialog`).
- Segmented controls wrap on small screens; deal cards contain their overlay link text.

### Phase 3: Search, catalog and supplier adapters (2026-09-29)

#### Added

- `@suskii/shared` money utilities (ADR-008): bigint minor units with ISO 4217 exponents, strict
  decimal parsing, explicit rounding modes, basis-point and ratio maths, largest-remainder
  allocation, exact rational FX and cross rates, `Intl` formatting and the `{ amountMinor, currency }`
  wire format. fast-check property tests against exact rational references.
- `@suskii/shared` time-zone helpers (local wall time to UTC with DST gap/overlap handling, day
  offsets) and flight/hotel search schemas (1-5 legs, spec traveller rules, 1-8 rooms, child ages).
- Migration 2: accent-folded `search_text` with GIN `pg_trgm` indexes on airports and cities;
  `markup_rules`, `fee_rules`, `promo_codes`, `promo_redemptions`, `offers` (quote snapshots) and
  anonymised `search_logs`.
- Catalog: `GET /v1/catalog/places` autocomplete ranked in SQL (IATA code, prefix, word prefix,
  typo-tolerant trigram similarity, boosts for major airports, Nigeria/Africa and multi-airport
  cities), `places/popular` (edge-cacheable index of about 1,170 airports), `airports/{iataCode}`,
  `countries`.
- Pricing engine: first matching markup rule by priority, stacking fee rules, promo codes (validity,
  verticals, minimum spend, caps, global and per-user limits, never discounting taxes), line-by-line
  conversion so breakdowns always sum. `FxProvider` with `MockFxProvider`, Redis cache and a 24 h
  last-known-good fallback. `POST /v1/pricing/promos/validate` with a single generic failure.
- Suppliers (ADR-009): Suskii-owned domain types, `FlightSupplier` / `HotelSupplier` interfaces,
  deterministic geographically plausible `MockFlightSupplier` and `MockHotelSupplier`, Zod-validated
  Duffel v2 flight adapter behind `FLIGHT_SUPPLIERS=duffel`, per-supplier circuit breakers and
  abort-aware timeouts, `pnpm --filter @suskii/api airlines:sync`.
- Search orchestration: `POST /v1/flights/searches` and `/v1/hotels/searches` call every enabled
  supplier in parallel inside a 12 s budget, return partial results with per-supplier outcomes (503
  only when all fail), de-duplicate itineraries, cache by normalised query in Redis and share
  concurrent identical fetches. Result pages with spec sorts, filters, facets, cursor pagination and
  display currency; offer and hotel detail; `410` with the original request once results expire.
- Quotes: `POST /v1/flights/offers/{offerId}/quote` and `/v1/hotels/rates/{rateId}/quote` re-price
  with the supplier, persist an `Offer` snapshot and report price changes.
- Search rate limits (per IP per minute and per day, per user), `X-Suskii-Client` sales channel,
  OpenTelemetry supplier latency/outcome and search metrics.
- Tests: 72 shared unit tests (money properties, time zones, schemas), 82 API unit tests (pricing
  engine properties, circuit breaker, timeouts, mock determinism, Duffel mapping and errors, result
  sorting/filters/facets) and 86 e2e tests (catalog, search end to end, caching, partial results
  with failing and hanging suppliers, circuit breaker, pricing rules, promos, quotes, expiry).

#### Changed

- The e2e harness runs the real reference-data seed; `resetState` also truncates pricing, offer and
  search tables.
- OpenAPI problem responses are generated for every referenced status; a test resolves every `$ref`.
- The seed strips OurAirports locality suffixes from city names (CDG and ORY group under Paris).
- `.env.example`: supplier flags, search timeouts and cache TTL, FX provider and cache TTL.

### Phase 2: Backend core (2026-09-29)

#### Added

- API platform: Zod-validated environment (production-only requirements, values never echoed),
  nestjs-pino with request ids and PII/credential redaction, OpenTelemetry (opt-in via OTLP
  endpoint), RFC 9457 problem details, strict security headers (CSP, HSTS preload,
  Permissions-Policy, no-store), CORS allowlist, 100 kB body cap, `/health` and `/ready`.
- Prisma 7 schema and init migration: identity, sessions and refresh-token families, MFA, social
  identities, verification tokens, idempotency keys, append-only audit log (database trigger),
  countries, cities, airports, airlines, trust signals, CMS blocks, FAQs. UUIDv7 ids.
- `@Contract()` route contracts (Zod): input validation, response filtering and a native OpenAPI 3.1
  generator; `apps/api/openapi.json` committed (ADR-005).
- `@suskii/api-client`: openapi-typescript schema, openapi-fetch client (bearer or CSRF header) and
  TanStack Query hooks; `pnpm generate:api`.
- Authentication (ADR-007): email + password (argon2id, HIBP k-anonymity check, enumeration-safe
  registration and reset, email verification), phone OTP, Google and Apple ID tokens with
  pre-hijacking defence, EdDSA access JWTs with JWKS and key rotation, rotating refresh tokens with
  reuse detection and family revocation, web cookies with session-bound CSRF tokens, device list and
  remote sign-out, TOTP MFA with encrypted secrets, replay protection and recovery codes.
- Authorisation: deny-by-default global guard, RBAC catalog in `@suskii/shared`, `@AdminRoute()`
  (staff role + MFA session + optional IP allowlist), admin endpoints for users, roles and the audit
  log.
- Abuse controls: lockout with exponential backoff, Redis sliding-window rate limits per IP, user,
  route, phone and email with `RateLimit-*` / `Retry-After`; `Idempotency-Key` interceptor
  (Postgres, 24 h: replay, in-flight conflict, payload mismatch).
- Audit log service for auth, session, MFA and RBAC events (hashed IPs, no PII).
- Email (SMTP/Mailpit, mock) and SMS (mock) providers behind interfaces.
- Reference data from OurAirports (249 countries, 4,008 airports with IANA zones, derived cities),
  idempotent seed with the five guardrail trust signals (three verified), draft CMS content and an
  optional local admin (ADR-006).
- Tests: 43 API unit tests (RFC 4226/6238 vectors, crypto, JWT rotation, contracts, config) and 65
  e2e tests against Postgres and Redis in Testcontainers.
- CI: e2e with Testcontainers, OpenAPI document and client drift check.
- `pnpm --filter @suskii/api keys:generate` (secrets), `data:build` (reference data).

#### Changed

- `.env.example`: new auth, cookie, CORS, email, SMS and telemetry variables; `KEY=` means unset.
- `registerRequestSchema` no longer takes a transport (registration never signs in directly).

### Phase 1: Design tokens and component libraries (2026-09-28)

#### Added

- `@suskii/design-tokens`: spec tokens (asserted equal to `PROJECT_SPEC.json`) plus WCAG-driven
  derived tokens; generated Tailwind v4 theme (web), Tailwind v3 preset (NativeWind) and CSS
  variables; WCAG contrast utilities and a 30-pairing contrast contract; compile tests proving only
  token utilities exist on both platforms.
- `@suskii/ui-web`: Button, Input, Tabs, SegmentedControl, Combobox, DateRangePicker,
  PassengerPicker, Card, DealCard, DestinationCard, Badge, TrustBar, Skeleton, Dialog (modal, sheet,
  fullscreen), Popover, Toast. Storybook 10 with the a11y addon. Vitest browser tests: axe on every
  story at mobile and desktop widths, keyboard interaction tests, tokens-only guard.
- `@suskii/ui-native`: native equivalents with NativeWind, `@gorhom/bottom-sheet` sheets, tested
  calendar logic, Reanimated skeleton with reduced-motion support; Jest + RNTL tests and a
  tokens-only guard.
- `@suskii/shared`: traveller rules (adults 1-9, infants <= adults, total <= 9) with Zod schema and
  stepper helpers.
- Web and admin apps styled through Tailwind v4 + tokens, fonts via `next/font` (latin + latin-ext).
- Mobile app wired for NativeWind, token fonts, gesture/bottom-sheet/safe-area providers, Jest.
- CI: Playwright Chromium (cached) for browser tests, Storybook build step.
- ADR-003 (UI stack and token pipeline), ADR-004 (accessible derived colour tokens).

#### Changed

- Spec's white-on-orange buttons use dark text; inputs use `border-strong`; focus uses a solid
  primary outline with the spec ring as a halo (ADR-004).

### Phase 0: Foundation and repo bootstrap (2026-09-28)

#### Added

- `PROJECT_SPEC.json` (owner spec), `CLAUDE.md` working guide, Windows-first `README.md`.
- Turborepo + pnpm 10 workspace with a dependency catalog, strict engine check (Node >= 24.9) and
  an allowlist for dependency install scripts.
- `@suskii/config`: strict TSConfig presets (base, library, node, nestjs, nextjs), type-aware
  ESLint flat-config factories (base, node, nest, next, expo), Prettier and Vitest base config.
- `@suskii/shared`: brand, currency (NGN default + 6), locale (en-NG default + 2) and vertical
  constants with Zod schemas and type guards. Dual ESM/CJS build via tsup.
- `apps/api`: NestJS 12 skeleton with URI versioning (`/v1`), version-neutral `GET /health`, Jest
  unit and e2e tests (supertest).
- `apps/worker`: Node ESM worker shell with Zod-validated env, pino logger with redaction, ordered
  component lifecycle with graceful shutdown, and a `GET /health` liveness server.
- `apps/web` and `apps/admin`: Next.js 16 App Router shells (admin is `noindex` through metadata
  and the `X-Robots-Tag` header).
- `apps/mobile`: Expo SDK 57 + Expo Router shell. CI bundles it for iOS and Android with
  `expo export`.
- `docker-compose.yml`: Postgres 16, Redis 7.4 (`noeviction`), Mailpit, with health checks, bound to
  `127.0.0.1`.
- `.env.example` with every variable from the spec (placeholders only).
- Husky + lint-staged (ESLint + Prettier on staged files) + commitlint (Conventional Commits).
- GitHub Actions CI: format check, lint, typecheck, unit tests, API e2e tests and build, using
  `turbo --affected` on pull requests. Dependabot for GitHub Actions.
- ADR-001 (architecture) and ADR-002 (toolchain and version pins).
