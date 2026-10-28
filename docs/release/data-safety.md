# Privacy forms: Google Play Data safety and App Store privacy labels

Answers for both stores' privacy forms, derived from what the app and the API actually do:
`docs/security/data-classification.md`, `docs/privacy/cars-data-map.md`, the data registry
(`apps/api/src/privacy/data-registry.ts`) and the app's permissions (`apps/mobile/app.config.ts`).

**Before submitting.** The owner and counsel confirm these answers against the published privacy
policy. Update this page in the same change as any new data, permission or provider; the store
forms must match the shipped build.

## Facts the answers rest on

- **No tracking.** No advertising, no advertising identifiers, no third-party analytics or
  tracking SDKs, no data brokers. Nothing is sold.
- **No device location.** The app never requests it. Riders choose pick-up and drop-off points
  on screen, and drivers choose their position the same way (device location is a backlog item;
  adding it changes these forms).
- **Camera only for scanning.** The camera scans boarding pass QR codes, and only operator agents
  use it. Nothing is recorded or uploaded.
- **Uploads come from the system document picker:** visa documents, a driver's documents and
  selfie, a renter's licence. They are encrypted per file on the server and deleted after their
  retention period.
- **Payment cards never reach the app or the API.** Payment providers' hosted pages take them
  (SAQ-A). The app sees the amount, reference and status.
- **Crash reports carry no user id**: a scrubbed message, a stack trace, the app version and tags
  from a fixed list (ADR-046). Set Sentry's "Prevent Storing of IP Addresses" for the project.
- **AI trip search (optional, ADR-061):** a described trip ("Lagos to London next Friday") is
  scrubbed of e-mail addresses, phone numbers and long digit runs, sent to the model provider
  (Anthropic) once to fill the flight form, and never stored or logged. It carries no user id.
  Off in production unless the owner turns it on.
- **Partner offers (ADR-069, ADR-070):** car rental, transfers, eSIMs, insurance and tours that
  partners sell open in the browser through a Suskii link. Suskii records which partner offer the
  user opened (programme, trip and account ids; no IP address, browser or URL) and sends the
  partner only a random click id. Partners report bookings against that click id for commission;
  conversions are counted per partner and never joined to people for advertising. Off in
  production unless the owner turns it on.
- **Ads (ADR-079) are website-only.** The website runs Meta and TikTok tags only after a visitor
  allows marketing cookies, and only website bookings made with that consent are reported to
  them. The app has no ad or attribution SDK and its bookings carry no ad attribution, so these
  forms do not change.
- **Encrypted in transit:** everything goes over HTTPS.
- **Deletion:** users can delete their account in the app (Account, Privacy) and on the website
  (`/account/privacy`). Financial records are kept without contact details for the legal period
  (`FINANCIAL_RECORDS_RETENTION_YEARS`, default 7).
- **Who receives data:**
  - suppliers, to fulfil what the user books: Duffel and airlines for flights, Duffel,
    Hotelbeds, Expedia and hotels for stays, bus operators, tour operators. Expedia also
    receives the IP address the booking was made from, which it requires on its booking call
    (ADR-086); the server keeps it encrypted only until that call, at most 7 days;
  - payment providers;
  - an email relay and Expo's push service;
  - Sentry for crashes;
  - the AI model provider for described trips, when AI trip search is on.

  All of them either act on our behalf (service providers) or receive data because the user
  booked with them, which both stores treat as expected transfers, not "sharing" or "tracking".

## Google Play: Data safety

**Overview answers.**

- Does your app collect or share any of the required user data types? **Yes.**
- Is all of the user data collected by your app encrypted in transit? **Yes.**
- Do you provide a way for users to request that their data is deleted? **Yes**, in the app and
  at the account deletion URL in the store listing.
- Independent security review (MASA): **No** (not yet commissioned).

**Data types.** "Collected" means sent off the device. "Shared" is answered **No** throughout,
for the reasons above. Processing is never optional for the core booking types, because a booking
needs them. Optional ones are marked.

| Category                 | Data type                    | Collected | Optional | Purposes                                                                                       | What it is                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------- | --------- | -------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personal info            | Name                         | Yes       | No       | App functionality, Account management                                                          | Account display name; traveller and passenger names on bookings                                                                                                                                                                                                                              |
| Personal info            | Email address                | Yes       | No       | App functionality, Account management, Developer communications, Fraud prevention and security | Sign-in, booking confirmations; marketing only with recorded consent                                                                                                                                                                                                                         |
| Personal info            | Phone number                 | Yes       | No       | App functionality, Account management, Fraud prevention and security                           | Sign-in codes, booking contact, ride contact                                                                                                                                                                                                                                                 |
| Personal info            | User IDs                     | Yes       | No       | App functionality, Account management                                                          | Account id                                                                                                                                                                                                                                                                                   |
| Personal info            | Address                      | Yes       | Yes      | App functionality                                                                              | Rental delivery address, when chosen                                                                                                                                                                                                                                                         |
| Personal info            | Other info                   | Yes       | Yes      | App functionality                                                                              | Dates of birth, nationality, gender and passport details that a fare or visa requires; emergency contacts' names and numbers (riders who add them)                                                                                                                                           |
| Financial info           | Purchase history             | Yes       | No       | App functionality, Account management, Fraud prevention and security                           | Bookings, payments, refunds, wallet, Suskii Prime, company trips and their approvals (company accounts, ADR-078)                                                                                                                                                                             |
| Financial info           | Other financial info         | Yes       | Yes      | App functionality                                                                              | A driver's bank account for payouts (drivers only)                                                                                                                                                                                                                                           |
| Location                 | Precise location             | Yes       | Yes      | App functionality                                                                              | Pick-up and drop-off points the user picks for a ride, and a driver's chosen position while online. Not device location                                                                                                                                                                      |
| Photos and videos        | Photos                       | Yes       | Yes      | App functionality, Fraud prevention and security                                               | Images the user uploads: visa documents, a driver's documents and selfie, a renter's licence                                                                                                                                                                                                 |
| Files and docs           | Files and docs               | Yes       | Yes      | App functionality                                                                              | PDFs the user uploads for a visa application or driver approval                                                                                                                                                                                                                              |
| Messages                 | Other in-app messages        | Yes       | Yes      | App functionality                                                                              | Messages to Suskii support and the replies (ADR-083); bodies encrypted, kept two years after the conversation is solved. Outside staffed hours the assistant's model provider processes them for an automated answer, as a service provider without user ids (ADR-085), which is not sharing |
| App activity             | Other user-generated content | Yes       | Yes      | App functionality                                                                              | Ride and trip ratings with comments; verified reviews of finished trips (rating, texts, trip type), published after moderation (ADR-077)                                                                                                                                                     |
| App activity             | In-app search history        | Yes       | No       | App functionality, Analytics                                                                   | Searches run on the server; search logs keep routes, dates and counts without the user. Described trips (AI trip search) are processed, not stored                                                                                                                                           |
| App activity             | App interactions             | Yes       | Yes      | App functionality, Analytics                                                                   | Partner offers the user opens (programme and trip ids), for partner commission                                                                                                                                                                                                               |
| App info and performance | Crash logs                   | Yes       | No       | App functionality, Analytics                                                                   | Error reports without user ids (Sentry)                                                                                                                                                                                                                                                      |
| App info and performance | Diagnostics                  | Yes       | No       | App functionality                                                                              | App version and platform with requests (`X-Suskii-Client`)                                                                                                                                                                                                                                   |
| Device or other IDs      | Device or other IDs          | Yes       | Yes      | App functionality, Fraud prevention and security                                               | Push token (if notifications are allowed); device attestation results (App Attest, Play Integrity)                                                                                                                                                                                           |

**Not collected:**

- web browsing;
- contacts (the device's address book is never read);
- calendar;
- health and fitness;
- emails and text messages (support conversations are in-app messages, above);
- audio;
- user payment info (card numbers);
- credit info;
- race and ethnicity, political or religious beliefs, sexual orientation;
- installed apps.

## App Store: privacy nutrition labels

**Data Used to Track You:** none. The app does not track users across other companies' apps or
websites, so it does not need App Tracking Transparency.

### Data Linked to You

| Category       | Data type               | Purposes                                                | Notes                                                                                |
| -------------- | ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Contact Info   | Name                    | App Functionality                                       | Account and travellers                                                               |
| Contact Info   | Email Address           | App Functionality, Developer's Advertising or Marketing | Marketing only with consent (newsletter, deal alerts)                                |
| Contact Info   | Phone Number            | App Functionality                                       |                                                                                      |
| Contact Info   | Physical Address        | App Functionality                                       | Rental delivery address                                                              |
| Contact Info   | Other User Contact Info | App Functionality                                       | Emergency contacts riders add                                                        |
| Financial Info | Other Financial Info    | App Functionality                                       | Drivers' payout bank accounts                                                        |
| Location       | Precise Location        | App Functionality                                       | Chosen pick-up and drop-off points; not device location                              |
| User Content   | Photos or Videos        | App Functionality                                       | Uploaded documents and selfies                                                       |
| User Content   | Other User Content      | App Functionality                                       | Visa and driver documents (PDF), ratings comments, trip reviews                      |
| User Content   | Customer Support        | App Functionality                                       | Conversations with Suskii support (ADR-083)                                          |
| Identifiers    | User ID                 | App Functionality                                       |                                                                                      |
| Identifiers    | Device ID               | App Functionality                                       | Push token                                                                           |
| Purchases      | Purchase History        | App Functionality                                       | Bookings, Prime, wallet, company trips                                               |
| Usage Data     | Product Interaction     | App Functionality, Analytics                            | Partner offers opened; partners get a random click id only                           |
| Other Data     | Other Data Types        | App Functionality                                       | Dates of birth, nationality, gender and passport details required by fares and visas |

### Data Not Linked to You

| Category       | Data type             | Purposes                     | Notes                                                                                                          |
| -------------- | --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Diagnostics    | Crash Data            | App Functionality            | Error reports without user ids                                                                                 |
| Diagnostics    | Other Diagnostic Data | App Functionality            | App version and platform on requests                                                                           |
| Search History | Search History        | App Functionality, Analytics | Search logs keep no user id; described trips (AI trip search) go to the model provider once and are not stored |

"Fraud prevention, security, and compliance" falls under App Functionality in Apple's
definitions. That covers payment risk scoring, referral fraud checks, rate limits and device
attestation.

## Keeping this page true

| Change                                                                                                                   | Update                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Device location for drivers or riders                                                                                    | Precise (and possibly Approximate) location from the device; the location permission text; background location needs Play's declaration |
| A new SDK (analytics, attribution, ads, chat)                                                                            | Both forms, and probably "tracking" on iOS (then App Tracking Transparency)                                                             |
| Native crash reporting (Sentry native SDK)                                                                               | Crash Data stays not linked if no user id is set                                                                                        |
| Sign in with Google or Apple in the app                                                                                  | Identifiers and the third-party sign-in data; Apple then also requires Sign in with Apple                                               |
| Storing described trips, or sending them with a user id                                                                  | In-app search history becomes linked to the user on both forms; `data-classification.md`                                                |
| A new upload or document type                                                                                            | Photos or Files rows, and `data-classification.md`                                                                                      |
| Attachments, WhatsApp or an outside helpdesk for support                                                                 | Support rows on both forms; an outside helpdesk shares data (Play: Shared); ADR-083                                                     |
| Sending support messages to the assistant's model with a user id, or letting the provider train on them                  | Support rows on both forms (Play: Shared); ADR-085                                                                                      |
| Marketing push notifications                                                                                             | Purposes: Developer's Advertising or Marketing; consent stays required                                                                  |
| Using the checkout IP for anything but the supplier's booking call (location, fraud scores), or keeping it after booking | Approximate location on both forms when it locates the user; `data-classification.md`; ADR-086                                          |
| Joining partner conversions to people (targeting, per-user reports)                                                      | Likely tracking on iOS (App Tracking Transparency) and Shared data on Play; ADR-070                                                     |
| Reporting app bookings or app events to ad networks (ADR-079)                                                            | Tracking on iOS (App Tracking Transparency prompt first) and Shared data on Play; a consent step in the app                             |
