# Owner launch checklist

Everything here needs you: an account in your company's name, a contract, a payment, a legal
filing or a decision only the owner can make. The code for every item is already built and
tested; each step says where its result goes and how to check it worked. Work top to bottom:
section 1 is what going live needs, the rest can follow.

## How to hand over keys safely

- **Never paste a key into a chat, an email, an issue or a file in the repository.**
- **Keys for the check workflows** (they call a provider with your test keys and print what
  came back): GitHub, the repository, Settings, Secrets and variables, Actions, **New repository
  secret**. Names that are not secret (a sender ID, a username) go under **Variables** instead.
- **Keys for the running website and API**: Google Cloud, Secret Manager, in each environment's
  project. List the name in `extra_secrets` in that environment's Terraform values
  (`infra/terraform/environments/<env>.tfvars`), then add the value with
  `gcloud secrets versions add <NAME> --data-file=-` (paste, then Ctrl+D). Plain settings (which
  provider, a sender ID) go in `api_env` in the same file.
- After adding a key, run the check workflow named in the step (GitHub, Actions, the workflow,
  **Run workflow**). A green run with real prices, rates or a text on your phone means it works.

## 1. Going live (blocks launch)

### 1.1 Cloud hosting and domains

1. Create **two Google Cloud projects** with billing: staging and production. Region: London
   (`europe-west2`) unless you prefer another.
2. Buy **two domains** (for example `suskii.com` and `suskii-staging.com`) and add each to
   **Cloudflare**. Production on the **Pro** plan (managed firewall rules).
3. Create a **Cloudflare API token per zone** with the permissions listed in
   `infra/terraform/README.md` ("What the owner provides").
4. Follow `infra/terraform/README.md`, "Bootstrap an environment", steps 0 to 9, for staging and
   then production (or ask Claude to walk you through it live).
5. In GitHub, create the environments **staging** and **production** with the variables in step
   7 of that README; require a reviewer on production. Then set the repository variable
   `DEPLOY_ENABLED` to `true`.
6. Decide on **customer-managed encryption keys** before the first production apply (optional;
   default Google-managed keys).

Check: `pnpm smoke --api https://<api host> --web https://<web host> --admin https://<admin host>`.

### 1.2 Taking payments (at least one provider)

| Provider              | Best for                        | Secret names                                         | Webhook URL to register                               |
| --------------------- | ------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| Paystack (start here) | Naira, cards, transfers, USSD   | `PAYSTACK_SECRET_KEY`                                | `https://<api host>/v1/payments/webhooks/paystack`    |
| Flutterwave           | Naira and other African money   | `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_WEBHOOK_HASH` | `https://<api host>/v1/payments/webhooks/flutterwave` |
| Stripe                | Cards in dollars, pounds, euros | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`         | `https://<api host>/v1/payments/webhooks/stripe`      |

1. Open the account in the company's name and finish the provider's business checks.
2. Put the **test** keys in staging's Secret Manager and `PAYMENT_PROVIDERS` in `api_env`;
   register the webhook URL in the provider's dashboard.
3. Make **one test payment per method** (card, transfer, USSD, mobile money, Apple or Google
   Pay) on staging and tell Claude: the channel names are then confirmed (ADR-074).
4. Flutterwave only: turn off **Enable Dashboard Payment Options**.
5. Then the **live** keys in production. Do not remove a provider later to pause it: use
   `PAYMENT_PROVIDERS_PAUSED`.

### 1.3 Flights (and hotels) from Duffel

1. Open a **Duffel** account; create a **test token** (`duffel_test_...`).
2. Add it as the repository secret `DUFFEL_API_TOKEN`; run **Duffel sandbox check**
   (`duffel-sandbox.yml`).
3. Ask Duffel to enable **Stays** (hotels) on the account; run the workflow again.
4. Put the **live** token in production's Secret Manager (`DUFFEL_API_TOKEN` in
   `extra_secrets`); `FLIGHT_SUPPLIERS` and `HOTEL_SUPPLIERS` are already `duffel` in the example.
5. For Nigerian domestic airlines not on Duffel: **IATA accreditation or a consolidator**.

### 1.4 Text messages (sign-in codes, booking and safety alerts)

1. **Termii** (Nigerian numbers): open an account, request a **sender ID** (for example
   `SuskiiTT`, up to 11 characters) and ask Termii to **activate the DND route** (without it,
   codes do not reach numbers on Nigeria's Do-Not-Disturb list).
2. **Africa's Talking** (other African numbers, optional if you only serve Nigeria at first):
   open an account, note the **username** and create an **API key**; register a sender ID.
3. Repository secrets `TERMII_API_KEY` and `AFRICASTALKING_API_KEY`; variables
   `TERMII_SENDER_ID` and `AFRICASTALKING_USERNAME`. Run **Text and exchange-rate check**
   (`messaging-sandbox.yml`) with your phone in the `to` box: a test text should arrive.
4. Production: the same keys in Secret Manager; `SMS_PROVIDER`, `SMS_ROUTES`,
   `TERMII_SENDER_ID` and `AFRICASTALKING_USERNAME` in `api_env` (already in the example).

### 1.5 Exchange rates

1. Open an **Open Exchange Rates** account (a paid plan updates hourly; the free plan's request
   limit is enough with the default one-hour cache). Copy the **App ID**.
2. Repository secret `OPENEXCHANGERATES_APP_ID`; run **Text and exchange-rate check**: every
   currency we sell should show a rate.
3. Production: the same in Secret Manager; `FX_PROVIDER = "openexchangerates"` in `api_env`.
4. **Decide the naira rate:** the market rate from the provider (default), or your bank's
   settlement rate, set as `FX_RATE_OVERRIDES = "NGN=<naira per dollar>"` and kept up to date.

### 1.6 Email

1. Pick an **email relay** (for example Amazon SES, Postmark, Mailgun or Brevo) and verify the
   domain with **SPF, DKIM and DMARC** records in Cloudflare.
2. `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `EMAIL_FROM` in `api_env`; `SMTP_PASSWORD` in
   Secret Manager.

### 1.7 Bot protection, virus scanning, errors and alerts

1. **Cloudflare Turnstile**: create a widget for the website's host. The site key is the GitHub
   environment variable `PUBLIC_TURNSTILE_SITE_KEY`; the secret is `TURNSTILE_SECRET_KEY` in
   Secret Manager.
2. **Virus scanning of visa documents**: decide where ClamAV runs (a small VM or Cloud Run
   service) and set `CLAMAV_HOST`, or choose a scanning service and ask Claude for its adapter.
3. **Sentry** (error reports): create the organisation (EU or US data region), turn on **Prevent
   Storing of IP Addresses**, and set `SENTRY_DSN` plus the public DSNs
   (`PUBLIC_SENTRY_DSN_WEB`, `PUBLIC_SENTRY_DSN_ADMIN`).
4. **Who is woken up**: addresses for `uptime_alert_emails` (or your on-call tool's channel ids)
   and `OPS_ALERT_EMAIL`.

### 1.8 Staff and the console

1. The **first super admin**: `infra/terraform/README.md` step 8.
2. Who holds each role: operations, finance (refunds need a second approver), support, content,
   visa officer, privacy officer. Grant them in the console.
3. Office or VPN addresses for `ADMIN_IP_ALLOWLIST` (the console only opens from there).

### 1.9 Money rules and legal texts

1. **Tax**: your accountant's rates, bases and registration number per country; enter them in
   the console (Pricing, Taxes). Nothing is seeded on purpose. `TAX_SELLER_COUNTRY` is `NG`.
2. **Markups and fees**: enter your margins in the console (Pricing). Nothing is seeded.
3. **Legal texts**: booking conditions and fare rules, the privacy policy (naming every
   recipient in `docs/privacy/records-of-processing.md`), the cookie policy and the terms of use.
4. **Support contacts** shown on the site: phone, email, WhatsApp number, office address.
5. **Licensed photography** for destinations (until then the site shows illustrated city art).

## 2. Phone apps in the stores

1. **Expo**: create the account and the EAS project. Repository secret `EXPO_TOKEN`; variable
   `EAS_PROJECT_ID`.
2. **Apple Developer** (organisation account; needs a **D-U-N-S number**) and the **App Store
   Connect** app; **Google Play** developer account.
3. The final **app ID** (placeholder `com.suskii.travels`).
4. **Push notifications**: Firebase (FCM) and Apple (APNs) credentials, uploaded to EAS.
5. **Device attestation**: a Google Cloud project with **Play Integrity** and Apple **App Attest**
   enabled. Then ask Claude to build the two verifiers (today the API records attestation in
   report-only mode, `DEVICE_ATTESTATION = "none"`, `ATTESTATION_MODE = "report"`).
6. Review the store listing (`docs/release/store-listing.md`) and confirm the privacy form
   answers (`docs/release/data-safety.md`).
7. Before submitting: someone with an iPhone and an Android phone runs the screen reader
   checklist (`docs/runbooks/screen-reader-checklist.md`).
8. Decide whether **Suskii Prime** is a travel service or needs in-app purchase on iPhone.

## 3. Sign in with Google and Apple

1. **Google**: an OAuth client for the website (and the app's relay). Put the client ID in the
   GitHub variable `PUBLIC_GOOGLE_CLIENT_ID` and the API setting `GOOGLE_CLIENT_IDS`.
2. **Apple**: a Services ID and the App ID. Set `PUBLIC_APPLE_SERVICES_ID` and
   `APPLE_CLIENT_IDS`.

## 4. More hotels, tours and commission (optional at launch)

| Partner       | What you need                                                                                        | Where it goes                                                          | Check                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| Hotelbeds     | Evaluation key, then certification and the live key                                                  | Secrets `HOTELBEDS_API_KEY`, `HOTELBEDS_API_SECRET`                    | `partner-sandbox.yml` (hotelbeds)     |
| Expedia Rapid | Expedia Partner Solutions account, sandbox credentials, then certification                           | Secrets `EXPEDIA_RAPID_API_KEY`, `EXPEDIA_RAPID_SHARED_SECRET`         | `partner-sandbox.yml` (expedia)       |
| Viator        | Partner API Basic Access and a campaign                                                              | Secret `VIATOR_API_KEY`; variable `VIATOR_CAMPAIGN`                    | `partner-sandbox.yml` (viator)        |
| Travelpayouts | Account with DiscoverCars, Localrent, Economybookings, GetTransfer, Kiwitaxi, Airalo and EKTA joined | Secrets `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER`; postback secret | `partner-sandbox.yml` (travelpayouts) |
| Metasearch    | Agreements with Google Flights, Skyscanner, KAYAK or Wego                                            | Partner keys are created in the console (Metasearch)                   | The partner's own test                |

Travelpayouts' postback URL: `https://<api host>/v1/partners/postbacks/travelpayouts` with
`TRAVELPAYOUTS_POSTBACK_SECRET` set in Secret Manager.

## 5. Ads with consent (optional)

1. **Meta**: the pixel ID and a Conversions API token. **TikTok**: the pixel code and an Events API
   token.
2. `META_PIXEL_ID` and `TIKTOK_PIXEL_ID` in `api_env` and the website settings;
   `META_CAPI_ACCESS_TOKEN` and `TIKTOK_EVENTS_ACCESS_TOKEN` in Secret Manager; then
   `AD_CONVERSIONS = "meta,tiktok"`.
3. Publish the cookie policy first.

## 6. Support

1. **People and hours**: who answers, on which hours (`SUPPORT_HOURS`, `SUPPORT_TIME_ZONE`), and
   the reply targets (`SUPPORT_SLA`; defaults 15 minutes urgent, 30 minutes Prime, 2 hours
   otherwise). The homepage promises 24/7 human support: staff it or ask Claude to change it.
2. **WhatsApp support**: a Meta business portfolio, a WhatsApp Business Account and number, a
   system user's permanent token, the app secret, a verify token and an approved template named
   `support_reply_waiting`. Settings in the Terraform example ("WhatsApp support").
3. **WhatsApp booking messages**: one approved template per message type; until then they stay
   off (`WHATSAPP_PROVIDER = "none"`) and travellers get email, push and texts.
4. **After-hours assistant**: an Anthropic API key as the repository secret `LLM_API_KEY`, one
   run of `ai-eval.yml` (suite `support-assistant`), your FAQs in the console, and its spend caps.

## 7. AI trip search (optional)

Same `LLM_API_KEY`; run `ai-eval.yml` (suite `natural-search`); decide whether to offer it in
production (`AI_SEARCH_ENABLED`) and its daily caps (defaults $0.05 per person, $20 in total).

## 8. Legal and compliance

1. **Data protection registration**: the NDPC (Nigeria), and the ODPC (Kenya) and the
   Information Regulator (South Africa) when you sell there; appoint a data protection officer
   (and an Information Officer for South Africa) and give them the `privacy_officer` role.
2. **Card payments**: fill in the yearly **PCI DSS SAQ A** with each payment provider's
   attestation (`docs/compliance/pci-saq-a.md`).
3. **Counsel review**: the rows marked "confirm" in `docs/compliance/privacy-obligations.md`; the
   transfer basis for London hosting and each provider; DPIAs for payment risk scoring and the
   AI features; whether the **company wallet** is stored value under CBN rules.
4. **Accessibility**: the support contact and legal text for an accessibility statement; an
   external audit before selling in the EU (optional).
5. **Suskii Prime** prices per market (console), and the referral rewards (zero until set).

## 9. People to name

Support staff, review moderators, visa officers, who fulfils packages and redeems vouchers,
finance approvers for refunds, a native speaker each for French, Swahili, Arabic and Portuguese
(booking, payment and refund wording first), and testers with iPhone and Android devices.

## 10. Decisions that already have a safe default

Nothing waits on these; change them when you want to (each is a setting or a console entry):

| Decision                              | Default today                                       |
| ------------------------------------- | --------------------------------------------------- |
| Installment deposit, fees, grace      | 30% deposit, no fee, 24 hours                       |
| Refund approval                       | Every staff refund needs a second approver          |
| Company wallet top-ups                | NGN 10,000 to 5,000,000, USD 10 to 5,000, 5 a day   |
| Package balance due                   | 30 days before departure                            |
| Visa document retention               | 90 days after closing                               |
| Financial records of deleted accounts | 7 years                                             |
| Price alerts                          | Every 6 hours, 5% drop                              |
| Review window                         | 90 days after the trip                              |
| Availability promise                  | 99.9% (status page)                                 |
| Rides and own fleet                   | Off in production (no driver KYC or payouts needed) |

## When you finish a step

Tell Claude which step is done (never the key itself). Claude then turns the setting on, runs or
reads the check, fixes anything the real provider answers differently, and updates this list.
