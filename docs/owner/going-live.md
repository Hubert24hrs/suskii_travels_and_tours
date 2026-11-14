# Going live: replace every stand-in

The testing backend (`suskii-travels-staging`, ADR-111) runs on stand-ins so that everything can
be tried without money, real accounts or real customers: a payment page that approves every
payment, made-up exchange rates, sample tours and cars, a mailbox that keeps every email. Before
the public can use Suskii, every one of them is switched off or replaced with the real thing.
This page lists them all, where each is set and what replaces it. The step by step setup of each
real provider is in the [launch checklist](./launch-checklist.md); the section is named in each
row.

## The rule that catches most of them

**Never set `ALLOW_MOCK_PROVIDERS` in production.** The testing backend sets it to `true`. In
production without it, the API refuses to start while any stand-in provider is still chosen,
and names each one in the error. That covers payments, flights and hotels, exchange rates,
email, texts, push, device checks, virus scanning, WhatsApp, flight status, the assistant's mock,
the AI search model, ads and file storage. Production also refuses to start without a Turnstile
secret, with the mock Google and Apple sign-in, or with a Duffel test token beside the test
payment page.

Sample data is different: nothing refuses it at start-up. That part is the second table below,
and it is done by hand, in the console.

## 1. Providers: stand-in today, real one for the public

| What                       | On the testing backend today                                   | For the public                                                                 | Launch checklist |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------- |
| Payments                   | `PAYMENT_PROVIDERS=mock`: the test page approves every payment | Paystack, Flutterwave or Stripe with live keys and their webhooks registered   | 1.2              |
| Flights                    | Duffel test mode (`duffel_test_` token) or the mock supplier   | Duffel live token, only together with a real payment provider                  | 1.3              |
| Hotels                     | Mock hotels (Duffel Stays needs access on your Duffel account) | Duffel Stays, Hotelbeds or Expedia Rapid with live keys                        | 1.3, 4           |
| Exchange rates             | Made-up rates (`FX_PROVIDER=mock`)                             | Open Exchange Rates, plus your bank's naira rate if you pin it                 | 1.5              |
| Email                      | The mailbox on the machine keeps every email (`mailbox`)       | A real email provider (SMTP); switch `mailbox` off                             | 1.6              |
| Text messages              | Mock: sign-in codes by text go nowhere                         | Termii (Nigeria) and Africa's Talking (elsewhere)                              | 1.4              |
| Bot protection (website)   | No Turnstile key: sign-up and guest checkout stay closed       | A Cloudflare Turnstile widget: site key and secret                             | 1.7              |
| Virus scanning             | Mock: uploads are not scanned                                  | ClamAV (or a scanning service)                                                 | 1.7              |
| Push notifications         | Mock                                                           | Expo push with Firebase (Android) and APNs (iPhone) keys                       | 2                |
| Device checks (app)        | Mock attestation                                               | Play Integrity (Android) and App Attest (iPhone)                               | 2                |
| Google and Apple sign-in   | Mock buttons on test stacks only (`SOCIAL_MOCK_ENABLED`)       | Your Google OAuth client ids, Apple Services ID and App ID                     | 3                |
| Ask Suskii                 | Gemini on Vertex AI, capped at 2 US dollars a day              | The same, after the eval run below and with production caps and Google's terms | 7.2, 7.6         |
| Errors and alerts          | No error tracking; `OPS_ALERT_EMAIL` empty                     | Sentry, an operations email and the on-call channel                            | 1.7              |
| WhatsApp (optional)        | Off                                                            | Meta's Cloud API, your number and approved templates                           | 6                |
| Partner offers (optional)  | Off in production; mock network on test stacks                 | Travelpayouts and Viator accounts                                              | 4                |
| Flight status (optional)   | Off                                                            | A flight data provider                                                         | (open question)  |
| Ads (optional)             | Off                                                            | Meta and TikTok pixel ids and tokens                                           | 5                |
| Prices from other websites | Off; mock vendor on test stacks                                | Vendor accounts, and each site approved with its basis                         | 7.1              |
| Rides, KYC, payouts, maps  | Off in production (ADR-069); mock providers on test stacks     | Stay off unless you decide to run rides; then a KYC, payout and maps provider  | (open question)  |

## 2. Sample and placeholder data: replace in the console

Nothing below stops the API from starting, so check each one by hand before launch.

| What                       | Today                                                                                                                                                       | For the public                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Packages, tours, visa help | Sample products from `db:seed:demo`, each marked "Sample"                                                                                                   | Your real products, prices, dates and rules, entered in the console (Catalog)                        |
| Add-ons                    | Sample insurance, airport transfers and eSIM                                                                                                                | Real add-ons from your partners (insurance may need a licensed partner)                              |
| Buses and rental cars      | Sample bus operators, terminals, departures and eight sample cars                                                                                           | Your real operators, routes and fleet with their real rates and terms                                |
| Suskii Prime               | One sample plan (NGN 25,000 or USD 25 a year)                                                                                                               | Your plans and prices per country                                                                    |
| Money rules                | No markups, fees, promo codes or tax rules                                                                                                                  | Your markups and fees, and the tax rates from your accountant                                        |
| Referral rewards           | Zero, so nothing is paid                                                                                                                                    | Your amounts, minimum spend and monthly cap                                                          |
| Contact details            | Empty (`site.contact`, `site.social`, `site.apps`)                                                                                                          | Your support phone, WhatsApp and email, social links and app store links                             |
| Legal pages                | None published                                                                                                                                              | Terms, privacy policy, cookie policy and booking conditions, published as legal pages in the console |
| Homepage claims            | "24/7 support", "Flexible payment" and "Secure payments" are marked verified; the traveller count and IATA accreditation stay hidden until you add evidence | Keep a claim only if it is true on launch day: "24/7 support" needs people on shift                  |
| Help articles              | Three starter FAQs                                                                                                                                          | Your own FAQs, and the policies Ask Suskii answers from (Knowledge in the console)                   |
| Test accounts and bookings | Everything made while testing lives in the testing backend's database                                                                                       | Production starts with a fresh database. Never copy the testing backend's data into it               |

On the testing backend, `sample_catalogue` re-seeds the samples at every release and nightly.
Terraform refuses that setting in an environment named `production`, and `db:seed:demo` refuses
to run in production mode, so production never gets sample data by itself; the work is to enter
the real data.

## 3. Test-only tools that never reach the public

- **The test APK** (the `e2e` app variant, with the Test server menu and mock device checks) and
  the hosted test server. Travellers get store builds of the `production` variant only.
- **Test addresses**: `api.`, `web.`, `admin.` and `mail.endpoints.suskii-travels-staging.cloud.goog`.
  The public site runs on your own domain behind Cloudflare (launch checklist 1.1).
- **The app's id** `com.suskii.travels` is a placeholder until the store listings exist
  (`APP_BUNDLE_ID`, launch checklist 2).
- **Test switches**: `MOCK_REPRICE_RULES`, `MOCK_SCHEDULE_CHANGE_RULES`, `MOCK_FLIGHT_STATUS_RULES`,
  demo drivers (`rides:demo`, `E2E_DEMO_DRIVERS`) and the phone check flows run on test stacks
  only.

## 4. Before travellers talk to Ask Suskii

Run the assistant's three evals against the real model once, in Cloud Shell, from the
repository folder. It costs about 2 US dollars. It sends 175 sample conversations through
Gemini and checks that each goes to the right specialist, states only prices and facts the
tools returned, and stays safe (never says something is booked or paid when it is not, never
asks for card details, always shows the notes a traveller must read). Nothing touches real
bookings or customer data.

```bash
gcloud builds submit . --config=infra/gcp/cloudbuild.agent-eval.yaml --service-account=projects/suskii-travels-staging/serviceAccounts/suskii-build@suskii-travels-staging.iam.gserviceaccount.com
```

Paste it once, on one line. The log ends with a pass count for each suite; send it to your
developer if any suite fails. Run it again whenever the assistant's prompts, tools or model
change.

## 5. The last check before launch

1. Production's settings have no `ALLOW_MOCK_PROVIDERS`, and the API starts (so no stand-in
   provider is left).
2. The console shows no product with a "Sample" badge, and every price, plan and rule is yours.
3. The legal pages, contact details and homepage claims are published and true.
4. A real payment of a small amount goes through end to end, and its refund too.
5. `pnpm smoke --api <api> --web <website> --admin <console>` passes against the public addresses.
