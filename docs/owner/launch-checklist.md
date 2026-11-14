# Owner launch checklist

Everything here needs you: an account in your company's name, a contract, a payment, a legal
filing or a decision only the owner can make. The code for every item is already built and
tested; each step says where its result goes and how to check it worked. Work top to bottom:
section 1 is what going live needs, the rest can follow.

Before the public launch, also work through [Going live: replace every stand-in](./going-live.md):
every mock provider, sample product and test switch the testing backend runs on, what replaces
each, and the assistant's eval run (about 2 US dollars) to do before travellers talk to it.

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
   (`duffel-sandbox.yml`). To see Duffel's test flights on the testing backend, put the same
   test token in its Secret Manager and deploy with `FLIGHT_SUPPLIERS=duffel` (ADR-116; the
   steps are in `docs/owner/deploy-backend-on-google-cloud.md`).
3. Ask Duffel to enable **Stays** (hotels) on the account; run the workflow again.
4. Put the **live** token in production's Secret Manager (`DUFFEL_API_TOKEN` in
   `extra_secrets`); `FLIGHT_SUPPLIERS` and `HOTEL_SUPPLIERS` are already `duffel` in the example.
5. For Nigerian domestic airlines not on Duffel: **IATA accreditation or a consolidator**.
6. **Special meals** (ADR-093): ask Duffel how its orders take a special meal request and make
   one sandbox booking with one. Until then travellers on Duffel fares are told to ask the
   airline, and no meal preference is collected.
7. **Seats** (ADR-094): run **Duffel sandbox check** with booking on. It reads the seat maps and
   orders one seat with the test ticket. When it passes, set `DUFFEL_SEAT_SELECTION = "true"`
   (staging first). Until then travellers on Duffel fares are told the airline sells no seats in
   advance. Decide whether Suskii adds a fee to seats (none today).
8. **Live flight status and delay alerts** (ADR-095): choose a **flight-data provider** and plan
   (for example Cirium, OAG, FlightAware AeroAPI or AeroDataBox) and tell Claude, who writes its
   adapter. Until then `FLIGHT_STATUS_PROVIDER` stays `none`: bookings show their booked times
   and no delay alert is sent. Decide whether alerts should also go by text or WhatsApp.
9. **Hotel photos** (ADR-096): after the Duffel Stays sandbox run, add the host its photo URLs
   use to the website's `IMAGE_REMOTE_HOSTS` (GitHub environment variable). Without it the
   website shows Duffel hotels without photographs; the app shows them either way.
10. **Hotel map and deals** (ADR-097): the map view shows hotels as pins without streets and
    links to the traveller's maps app. For a street map, choose a **tile provider** (MapTiler,
    Mapbox, Google Maps Platform or a self-hosted server) and tell Claude; it must also be named
    in the privacy policy. Confirm the deal rule (15% below the usual price of the star class,
    at least five hotels to compare, guest score 7 or more). "Things to do" on hotel pages
    shows once Viator is connected (section 4).

### 1.4 Text messages (sign-in codes, booking and safety alerts)

1. **Termii** (Nigerian numbers): open an account, request a **sender ID** (for example
   `SuskiiTT`, up to 11 characters) and ask Termii to **activate the DND route** (without it,
   codes do not reach numbers on Nigeria's Do-Not-Disturb list).
2. **Africa's Talking** (other African numbers, optional if you only serve Nigeria at first):
   open an account, note the **username** and create an **API key**; register a sender ID.
3. Repository secrets `TERMII_API_KEY` and `AFRICASTALKING_API_KEY`; variables
   `TERMII_SENDER_ID` and `AFRICASTALKING_USERNAME`. Run **Text and exchange-rate check**
   (`messaging-sandbox.yml`) with your phone in the `to` box: a test text should arrive.
4. Production: the same keys in Secret Manager; `SMS_PROVIDER = "termii"` and
   `TERMII_SENDER_ID` in `api_env` (already in the example). When you sell outside Nigeria, add
   Africa's Talking for those numbers with `SMS_ROUTES` (the example shows how).

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
9. Optional: a **device farm** account (Firebase Test Lab, BrowserStack or AWS Device Farm). The
   phone check (ADR-100) runs the test build on an emulator; a farm runs the same journeys on
   real phones before a store release.

## 3. Sign in with Google and Apple

1. **Google**: an OAuth client for the website (and the app's relay). Put the client ID in the
   GitHub variable `PUBLIC_GOOGLE_CLIENT_ID` and the API setting `GOOGLE_CLIENT_IDS`.
2. **Apple**: a Services ID and the App ID. Set `PUBLIC_APPLE_SERVICES_ID` and
   `APPLE_CLIENT_IDS`.

Before the App Store submission, check the **Apple button** on the Sign in card against Apple's
guidelines for Sign in with Apple. The card shows Apple's mark and the word "Apple" (ADR-108);
Apple names the titles its button may carry, so review may ask for "Continue with Apple" or for
the mark alone. Android and the website are not bound by that rule.

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
5. **Group flights** (ADR-093): requests for 10 travellers or more arrive in the support inbox
   under the topic "Group booking request". Name who answers them and collect each airline's
   group desk contact; nothing is priced automatically.

## 7. AI trip search (optional)

Same `LLM_API_KEY`; run `ai-eval.yml` (suite `natural-search`); decide whether to offer it in
production (`AI_SEARCH_ENABLED`) and its daily caps (defaults $0.05 per person, $20 in total).

### 7.1 Prices from other websites (optional)

Where no supplier has a price, the platform can read one from a public web page and show it
as indicative ("Seen on ... We confirm the live price before you pay"). It is built and off.
Nothing is read until you have done all of this:

1. **Decide with counsel which sites.** For each one, read its robots file and its terms. If
   either disallows automated access, you need the site's own licence or written permission;
   an assessment or a note cannot overrule the site. Never accept a site's or a vendor's terms
   without reading them: only you can agree to them.
2. **Open the vendor accounts you want** (any subset; each is used only where a site's policy
   names it), in your company's name, with a spending limit on the vendor's side:

   | Vendor      | What you need                                          | Where it goes                                             |
   | ----------- | ------------------------------------------------------ | --------------------------------------------------------- |
   | Firecrawl   | An API key                                             | Secret `FIRECRAWL_API_KEY`                                |
   | Apify       | An API token; the actor you will run for each site     | Secret `APIFY_TOKEN`                                      |
   | Browse AI   | An API key; a robot you train on each site, in its app | Secret `BROWSE_AI_API_KEY`                                |
   | Oxylabs     | A Web Scraper API user                                 | Variable `OXYLABS_USERNAME`, secret `OXYLABS_PASSWORD`    |
   | Bright Data | An API key and a Web Unlocker zone                     | Secret `BRIGHT_DATA_API_KEY`, variable `BRIGHT_DATA_ZONE` |

3. **Check the keys**: GitHub, Actions, **Web-data vendor check**, Run workflow. Leave the
   page empty to check the keys only; give a page of **your own website** to have each vendor
   read it once. The adapters were written from the vendors' published SDKs, not from a live
   account, so a green run with a page is what confirms each one. Do not point it at anyone
   else's site.
4. **Turn it on per environment**: `PRICE_INTEL_ENABLED = "true"` and
   `PRICE_INTEL_VENDORS = "firecrawl,oxylabs"` (the ones you opened) in `api_env`, the keys in
   Secret Manager, and `PRICE_INTEL_BOT_URL` (a public page saying who reads and how to reach
   you) when `direct` is among the vendors. Set what each vendor charges you in
   `PRICE_INTEL_COSTS` so the budgets count in your prices.
5. **List and approve each site in the console** (Data sources): its page addresses, its
   recipe, what its robots file and terms say, the vendors in order and the highest proxy
   class you allow. Approval asks for your authenticator and a basis with where it is written
   down. The register for counsel: `pnpm --filter @suskii/api price-intel:register`.
6. **Budgets**: defaults are $5 a day and $50 a month per vendor, $2 and $20 per site. Change
   them in the console; you are told at 50, 80 and 100%.

If a site asks you to stop: Data sources, the site, **Block**
(`docs/runbooks/price-intelligence.md`).

### 7.2 The assistant (optional)

A chat assistant that helps travellers search, plan a trip, understand a booking or a payment
and reach your support team. It never books, pays, refunds or confirms anything by itself: it
shows options, opens the ordinary pages and brings in a person. For a few actions on the
traveller's own booking (cancelling it under its policy, accepting an airline's new times,
taking the airline's full refund, watching a price) it shows a card with exactly what would
happen, and nothing happens unless the traveller taps to confirm. It is built and off: the
website and the app show it only once it is switched on (7.5 says what travellers then see).
What is yours to do before it answers anyone:

1. **The model.** Ask Suskii answers with Google's Gemini (ADR-109). On the Google Cloud
   machine it calls **Gemini 3.5 Flash through Vertex AI as the machine's own identity, with
   no key** (ADR-112): there is nothing to create or paste. Google refused Gemini 2.5 Flash to
   the new project and served 3.5 Flash. Read Google's terms for Gemini on Vertex AI with
   counsel, in particular where requests are processed and whether prompts are kept. Only you
   can accept those terms. A key is needed only to run the evals from GitHub: create one in
   Google AI Studio (<https://aistudio.google.com/apikey>) on a project with billing and add
   it as the repository secret `GEMINI_API_KEY`.
2. **Measure it against the real model.** Done on 2026-11-12 against Gemini 3.5 Flash on Vertex
   AI, on Cloud Build, with no key (ADR-112 has the figures). It passes when routing reaches
   95%, no invented figure, date, contact or outcome is shown and 90% of grounded answers are,
   and no red-team case breaks through. Run it again after any change to the assistant's
   prompts, tools or model, before it answers travellers: in Cloud Shell, from the repository,
   `gcloud builds submit . --config=infra/gcp/cloudbuild.agent-eval.yaml --service-account=projects/suskii-travels-staging/serviceAccounts/suskii-build@suskii-travels-staging.iam.gserviceaccount.com`
   (about 2 US dollars a run at the list price), or GitHub, Actions, **Agent evals**, with the
   key. **Replay the recorded answers** there needs no key, calls no model and costs nothing:
   it measures the workflow, not the model.
3. **Choose the models.** Default: Gemini 3.5 Flash to route, to answer and as the fallback.
   If you change one, run the evals again with it and set its price in `AGENT_MODEL_PRICES`;
   update that setting whenever the provider's price list changes, because the spend caps
   count in it.
4. **Spend caps.** Defaults: 6 cents reserved per answer, 50 cents a day per signed-in
   traveller, 12 cents a day per guest address and $50 a day in total. Over a cap the assistant
   says it has reached the day's limit and the ordinary screens still work. The staging machine
   has its own, lower caps: $2 a day in total, $1 per traveller and 20 cents per guest.
5. **Help articles.** The assistant answers questions about rules (refunds, changes, bags,
   documents) only from the help articles you publish in the console, and says it does not
   know when none fits. Three are seeded; write yours before it goes live.
6. **Who answers a handover.** When a traveller asks for a person, a support conversation
   appears in the inbox under the topic "From the assistant" with the traveller's own words.
   Name who answers them and during which hours.
7. **Switching it on** (`AGENT_ENABLED`) needs the agent service deployed, which comes with the
   last part of this work. Staff with the `ai:manage` permission can pause it everywhere within
   seconds from the console.

### 7.3 Assisted quotes and the staff assistants (optional)

**Assisted quotes.** When the ordinary search does not sell what a traveller wants, or they
saw a price elsewhere, they can ask for it to be confirmed. A person on your team checks the
live price with the supplier and records it; the traveller then books and pays it like any
other booking; after payment a person books it with the supplier and records the supplier's
confirmation, and only then is the booking confirmed. If it cannot be booked, everything is
refunded automatically. Built and off (`ASSISTED_QUOTES_ENABLED`). Before switching it on:

1. **Name who works the queue, and when.** Two jobs: verifying prices (the `ai:approve`
   permission: operations, finance, support) and booking paid ones by hand (`bookings:manage`:
   operations). A request nobody answers in 48 hours closes and tells the traveller
   (`ASSISTED_QUOTE_REQUEST_HOURS`); choose a time you can keep. An offer can be booked for two
   hours (`ASSISTED_QUOTE_VALID_MINUTES`).
2. **Decide what a quote earns.** Today nothing: the traveller pays the supplier's verified
   price. Add a fee rule for the product "Assisted quotes" in the console (Pricing, Fees) for a
   fixed fee or a percentage. The price never goes below what the supplier charges.
3. **Decide where proof is kept.** The forms take a web address (https) for the proof of the
   supplier's price and of its confirmation: a shared drive your staff can open. No file is
   uploaded to Suskii.
4. **Supplier accounts.** An assisted booking is made by a person with a supplier you have an
   account with, paid from your side. Nothing is bought from a website Suskii has no agreement
   with.

**Staff assistants.** In the console, staff can ask an assistant what is waiting (operations),
how sales and refunds stand (finance, business intelligence, the executive summary), how promo
codes are doing (marketing) and how reading prices from other websites stands. It answers from
the same figures the console shows that person and sees nothing they could not see. It can
prepare two things, a refund request and a promo code, and neither does anything by itself:

5. **Name who decides.** What an assistant prepared waits in an approvals queue. The person
   who asked can never approve it; someone else with the `ai:approve` permission and the right
   to do that thing themselves does. An approved refund request then follows your ordinary
   refund rule (a second approver); an approved promo code is created switched off.
6. **The same key and limits** as the assistant for travellers (7.2): the model key, the
   evaluation run, the spend caps and the pause switch cover the staff assistants too.

### 7.4 Running the assistant from the console (optional)

Once the assistant is switched on (7.2), these pages of the console are where your team runs
it. They show for operations, finance, support and super admins.

1. **Upload what the assistant should answer rules from.** Console, Knowledge base, Add a
   document. Save each policy or procedure as plain text or Markdown first (nothing is read
   from a PDF or a Word file), at most 512 KB each. Headings (lines starting with `#`) become
   the sections the assistant quotes. Choose "Travellers" for what a traveller may be told and
   "Staff only" for internal procedures. Never upload anything about a person. Only super
   admins can add or archive a document today.
2. **Try a question before relying on it.** On the same page, "Try a question" runs the
   search the assistant runs and shows the passages a traveller would be answered from.
3. **Name who keeps the documents current.** A document that is out of date is archived and
   the new version added; nothing is deleted, and the audit log says who did what.
4. **Set the model prices.** `AGENT_MODEL_PRICES` holds the price per million tokens of each
   model you use. Without it every cost on "Assistant cost and quality" reads as nothing. The
   figures there are estimates from token counts; your provider's invoice is the actual cost.
5. **Decide who may read travellers' conversations.** "Assistant activity" shows them with
   contact details and document numbers removed, and every opening is recorded with the
   reader's name. Everyone who can see the assistant's pages can open one today; say if that
   should be fewer people.
6. **Know the two switches.** "Pause the assistant" stops every chat within seconds and needs
   no code; releasing it needs an authenticator code. A single agent (hotels, say) can be
   switched off on its own: its questions then go to the general agent.

### 7.5 What travellers see of the assistant (optional)

Built with the website and the app; all of it is hidden while the assistant is off (7.2), and
search, booking and payment work the same either way (tested on a stack without it).

1. **Where it is.** The website shows "Assistant" in the top bar and the phone menu, leading
   to its own page; the app offers it from Account. A traveller can ask without an account;
   a booking, a price request and remembered preferences need one. Say if only signed-in
   travellers should be able to use it.
2. **Price requests.** A traveller asks for a price to be confirmed (website: Price
   requests; app: Account, Price requests), your team verifies it in the console (7.3), and
   the traveller books it through the ordinary checkout. They can save a request, and a
   combined trip, as a PDF. Have counsel read the notes printed on both ("an offer is not a
   booking", "to be confirmed", "a plan is not a booking").
3. **What the assistant remembers.** Nothing, until a traveller switches it on under
   "What the assistant remembers": then a home airport, a cabin, window or aisle, up to
   three airlines and whether price or comfort comes first. They see, change and erase each,
   and switching it off erases all. A meal preference is not remembered: it can reveal
   religion or health, and waits for counsel's view (ADR-093). Your privacy policy should
   name this, with consent as its basis.
4. **The assistant on WhatsApp** (off unless you set `AGENT_WHATSAPP_ENABLED`). It needs
   WhatsApp support first (section 6, item 2). It then answers a traveller's WhatsApp
   message in the same thread your team reads: searches and rules only, nothing about an
   account, and no confirmations. Its first answer says it is automated. It hands over to
   your team when asked, when it cannot help, after 12 answers
   (`AGENT_WHATSAPP_MAX_REPLIES`), or the moment one of your people replies; after that it
   says nothing more in that thread. Decide whether to offer it, and who reads the handovers
   out of hours. Meta bills these messages as it bills your team's replies, and your privacy
   policy must say that an automated assistant may answer there.
5. **When a traveller asks for a person**, the assistant says when your team aims to reply,
   from your own reply targets (`SUPPORT_SLA`, section 6 item 1), as an aim and never a
   promise. Set targets you can keep.
6. **How it is doing.** After an answer a traveller can score the conversation out of five.
   Console, "Assistant cost and quality", shows the scores and what conversations led to
   (searched, asked a person for a price, confirmed something, handed over).
7. **Store forms.** Conversations with the assistant and remembered preferences are now on
   the privacy forms page (`docs/release/data-safety.md`); confirm the answers before the
   next store release.

### 7.6 Putting the assistant on a server (optional)

Everything here is built and nothing is applied: no server runs the assistant until you do
these steps. Do them on staging first. The runbook for the people on call is
`docs/runbooks/ai-agent.md`; what it may cost is in
[`assistant-cost-estimate.md`](assistant-cost-estimate.md) (estimates, not invoices).

1. **Run the three evaluations against the real model** (once, before any traveller is
   answered). Add `LLM_API_KEY` as a repository secret, then Actions, Agent evals, Run
   workflow. Each suite leaves a small file as an artifact. A super admin records each file in
   the console (Assistant cost and quality, Evaluations, Record a run), so there is a dated
   record of which model was measured, on which commit, and whether it passed. The first runs
   against a real model were made on 2026-11-12, on Cloud Build against Gemini on Vertex AI
   (ADR-112).
2. **Create the assistant's two tokens.** `pnpm --filter @suskii/api keys:generate` prints
   `AGENT_RUN_TOKEN` and `AGENT_TOOLS_TOKEN` with the other keys. Put each straight into
   Secret Manager, never into a file or a chat, together with `LLM_API_KEY`.
3. **Have Terraform create the service.** In the environment's variables: add the three names
   to `extra_secrets`, apply and give each a value; then set `deploy_agent = true` and apply.
   The steps are in `infra/terraform/README.md`, "The agent service". The service is reachable
   only from inside your own network.
4. **Deploy, then point the API at it.** Run the Deploy workflow: it finds the new service,
   creates its database role and rolls its image out. Then copy the `agent_internal_url`
   output into `AGENT_URL` in `api_env` and apply. `AGENT_ENABLED = "true"` is the last step
   (item 9), and yours to decide.
5. **Choose the monthly figure you want to be told about**
   (`AGENT_MONTHLY_ALERT_MICROUSD`, in millionths of a dollar: `300000000` is $300). You are
   told once when the month is heading past it and once when it is past it. It stops nothing;
   the daily cap (`AGENT_GLOBAL_DAILY_MICROUSD`, $50 a day today) is what stops spending.
6. **Name who receives the alerts.** Five alerts for the assistant and price intelligence
   raise a ticket and none pages: runs failing, answers refused by the guard, the monthly
   cost, a site whose pages stopped reading, a budget at its cap. They go where your other
   alerts go (section 1.7).
7. **Trying a new wording safely (later).** A new version of the assistant's instructions can
   run "in the shadow": on a share of real questions, after the real answer has gone out,
   answering nobody. The console then compares it with the wording in use. It is off; a
   developer switches it on for one candidate (`AGENT_SHADOW_PROMPTS`,
   `AGENT_SHADOW_SAMPLE_PERCENT`) and it has its own cap of $2 a day.
8. **When a site changes its pages.** The price intelligence assistant in the console can
   prepare the fix from the page that was kept. It waits in Approvals for someone other than
   the person who asked; name two people who may manage data sources, since today only super
   admins can.
9. **Switch it on.** Staging first, with the mock model, to see the screens; then the real
   model on staging; then production, when you have read real conversations and are content.
   Pausing takes seconds and needs no code (7.4, item 6).

## 8. Legal and compliance

1. **Data protection registration**: the NDPC (Nigeria), and the ODPC (Kenya) and the
   Information Regulator (South Africa) when you sell there; appoint a data protection officer
   (and an Information Officer for South Africa) and give them the `privacy_officer` role.
2. **Card payments**: fill in the yearly **PCI DSS SAQ A** with each payment provider's
   attestation (`docs/compliance/pci-saq-a.md`).
3. **Counsel review**: the rows marked "confirm" in `docs/compliance/privacy-obligations.md`; the
   transfer basis for London hosting and each provider; DPIAs for payment risk scoring and the
   AI features; whether the **company wallet** is stored value under CBN rules; and whether a
   **special meal request** (halal, kosher, diabetic) is special-category data in each market,
   with the matching answer on the store forms (`docs/release/data-safety.md`).
4. **Accessibility**: the support contact and legal text for an accessibility statement; an
   external audit before selling in the EU (optional).
5. **Suskii Prime** prices per market (console), and the referral rewards (zero until set).

## 9. People to name

Support staff, review moderators, visa officers, who fulfils packages and redeems vouchers,
finance approvers for refunds, who verifies assisted quotes and books them by hand, who decides
what the staff assistants prepare, a native speaker each for French, Swahili, Arabic and Portuguese
(booking, payment and refund wording first), and testers with iPhone and Android devices.

## 10. Decisions that already have a safe default

Nothing waits on these; change them when you want to (each is a setting or a console entry):

| Decision                              | Default today                                          |
| ------------------------------------- | ------------------------------------------------------ |
| Installment deposit, fees, grace      | 30% deposit, no fee, 24 hours                          |
| Refund approval                       | Every staff refund needs a second approver             |
| Company wallet top-ups                | NGN 10,000 to 5,000,000, USD 10 to 5,000, 5 a day      |
| Package balance due                   | 30 days before departure                               |
| Visa document retention               | 90 days after closing                                  |
| Financial records of deleted accounts | 7 years                                                |
| Price alerts                          | Every 6 hours, 5% drop                                 |
| Flexible dates                        | 3 days each side (`FLEXIBLE_DATES_DAYS`, 0 is off)     |
| Delay alerts                          | From 30 minutes late, again per 15-minute move         |
| Review window                         | 90 days after the trip                                 |
| Availability promise                  | 99.9% (status page)                                    |
| Rides and own fleet                   | Off in production (no driver KYC or payouts needed)    |
| Rental driver age                     | 21 unless a car says otherwise; under it is refused    |
| Longest rental                        | 90 days                                                |
| Combined trips (trip builder)         | The total is the sum of the parts: no discount, no fee |
| Unpaid trips per account              | 10                                                     |

If you switch the **own rental fleet** on (ADR-069, ADR-098), enter for each car in the console
(Rental desk, New car): the daily rate and, if you offer them, the price of a week and of 30
days; the minimum driver age; the airport code when the branch is at an airport; the daily price
of a child seat, a GPS and an additional driver; the countries the car's insurance lets it enter
and the flat cross-border fee; and the other branches it may be returned to with each one-way
fee. Decide who hands over the border papers at pickup.

The **trip builder** (ADR-099) lets a traveller put a flight, a hotel, a rental car, an airport
transfer and travel insurance together and pay once. It sells what is already on sale: a car
needs the rental fleet switched on, and transfers and insurance are the add-ons you publish in
the console (Add-ons). Tell us if a combined trip should get a discount.

## When you finish a step

Tell Claude which step is done (never the key itself). Claude then turns the setting on, runs or
reads the check, fixes anything the real provider answers differently, and updates this list.
