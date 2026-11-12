# The backend on Google Cloud

The backend runs on Google Cloud in one of two shapes. You chose the first on 2026-11-12, and
it is the one that is live. The second is built and waits for a bigger budget.

| Shape               | What runs                                                               | Roughly per month     |
| ------------------- | ----------------------------------------------------------------------- | --------------------- |
| **One machine**     | One Compute Engine VM with everything: the API, Ask Suskii, the website | 40 to 45 US dollars   |
| **Managed** (later) | Cloud Run, Cloud SQL and Memorystore, each looked after by Google       | 130 to 230 US dollars |

Both figures are estimates from Google's list prices, not quotes.

## What is live now: one machine

- **Project** `suskii-travels-staging`, in London (`europe-west2-a`), billed to your "Suskii
  Errands" billing account.
- **The API** at `https://api.endpoints.suskii-travels-staging.cloud.goog`, with a certificate
  that renews by itself. The name is Google's free one for the project; your own domain can
  replace it later.
- **The website** at `https://web.endpoints.suskii-travels-staging.cloud.goog` and **the admin
  console** at `https://admin.endpoints.suskii-travels-staging.cloud.goog`.
- **The worker**, which refreshes fares and deals and sends reminders, and **Ask Suskii's own
  service**. Neither is reachable from outside.
- **PostgreSQL and Redis** on the same machine, with their data on a disk of its own that
  outlives the machine.
- **A backup** of the database every night at about 02:15 UTC and before every deploy, kept 30
  days in a private bucket (`suskii-travels-staging-backups`).
- **Every key** in Secret Manager, generated for you and never shown.
- **A mailbox** at `https://mail.endpoints.suskii-travels-staging.cloud.goog` (ADR-113). Every
  email the platform sends lands there and goes no further: confirmations of an address,
  booking emails, password resets. The user name is `suskii`; the password is in
  [Secret Manager](https://console.cloud.google.com/security/secret-manager/secret/MAILBOX_PASSWORD/versions?project=suskii-travels-staging)
  (open the latest version's menu, **View secret value**). Keep it like a staff password:
  whoever reads the mailbox can reset any account's password on this backend. Mail is kept a
  week.

It runs on the built-in stand-ins for airlines, hotels, payments and texts, so no real money
moves and no email reaches a real inbox. Each real provider is connected later with its key.

**What you can try on it.** Flights, hotels, combined trips, deals, Ask Suskii, and the
sample catalogue the test server has always shown: sample packages, tours, add-ons, visa
products, a Suskii Prime plan, buses and rental cars, each with a "Sample" badge. Rides are
off: there are no drivers on this backend to answer a request. Offers from partners and price
requests are off too, until there are partner accounts and staff to answer.

The sample catalogue is a switch. To hide buses and rental cars and stop refreshing the
samples, run the deploy command below with `SAMPLE_CATALOGUE=false` in front of it. The sample
packages, tours and the Prime plan then stay, badged, until you unpublish them in the console.

To point the test app at it: Account, Test server, and enter
`https://api.endpoints.suskii-travels-staging.cloud.goog` as the API address and
`https://web.endpoints.suskii-travels-staging.cloud.goog` as the website address.

### Two things the website and the console still need from you

**1. A Turnstile widget, so people can sign up on the website.** The website's sign-up, guest
checkout and newsletter forms are protected against bots by Cloudflare Turnstile, and they
stay closed until a widget exists for this website. Signing in, searching and paying work
without it, and the app is not affected: it proves itself another way.

1. Create a free Cloudflare account and open Turnstile:
   <https://dash.cloudflare.com/?to=/:account/turnstile>.
2. Add a widget for the hostname `web.endpoints.suskii-travels-staging.cloud.goog`. Cloudflare
   shows a **site key** and a **secret key**.
3. Open
   <https://console.cloud.google.com/security/secret-manager/secret/TURNSTILE_SECRET_KEY/versions?project=suskii-travels-staging>,
   press **New version**, paste the secret key and save.
4. Run the deploy command below with `TURNSTILE_SITE_KEY=the-site-key` in front of it. The
   site key is public by design.

**2. The first admin of the console.** Only you can do this, because it is your account, your
password and your authenticator. It takes about five minutes:

1. Sign up in the test app (pointed at this backend as above) with the address that should be
   the admin.
2. Open the mailbox (above), find the email that confirms your address and open its link. The
   website says the address is confirmed.
3. Open the machine's **SSH** button (see "Look at it" below) and run, with that address:

   ```bash
   sudo /opt/suskii/ops scripts/staff-bootstrap.ts --email you@example.com --yes
   ```

4. Sign in to the console with the same address and password. It asks you to set up two step
   verification with an authenticator app before it opens.

The bootstrap works once: after it, roles are given in the console, with the authenticator.

### What this shape does not give you

- It is one machine. When Google restarts it, or it is updated, the backend is down for about
  a minute.
- The database is backed up once a night. A failure can lose up to a day of data.
- There is no firewall service in front of it beyond the API's own limits and bot checks.

It is the right size for testing the app with real people. Before paying customers depend on
it, move to the managed shape.

**The machine's size stays as it is** (`e2-medium`, 4 GB). It uses about 1.4 GB with
everything running, and a deploy needs room above that for a moment. Half the size (`e2-small`,
2 GB) would save about 15 US dollars a month and run on its swap file. To change it anyway, run
the deploy command below with `MACHINE_TYPE=e2-small` in front of it; the machine restarts once.

### Ask Suskii and the rest of the platform

Ask Suskii runs in its own container, with its own keys and its own corner of the database,
and it has a ceiling on the memory and processor time it may use. If it is slow, wrong or
down, searching, booking and paying carry on. A chat then ends with a short "unavailable"
note.

**It answers with Google's Gemini, and nothing was needed from you** (ADR-112). The machine
calls Gemini on Google's Vertex AI as its own Google identity, so there is no key to create,
paste or protect. The requests are processed in London, beside the machine.

- The model is **Gemini 3.5 Flash**. Google no longer gives Gemini 2.5 Flash to new projects:
  it refused yours, in London and everywhere else, and gave 3.5 Flash, its current Flash model.
- What it costs is capped on this machine: 2 US dollars a day in all, 1 dollar for one signed
  in traveller and 20 cents for a guest. Past a cap, a new message is told the assistant has
  reached today's limit, and the rest of the platform carries on.
- Before a change to the assistant's prompts, tools or model reaches travellers, its three
  evals run against the model, on Google Cloud, with no key. They passed on 2026-11-12 (routing
  98 of 98, grounding 16 of 16 with nothing invented, safety 41 of 41). A run costs about 2 US
  dollars; from Cloud Shell, in the repository:
  `gcloud builds submit . --config=infra/gcp/cloudbuild.agent-eval.yaml --service-account=projects/suskii-travels-staging/serviceAccounts/suskii-build@suskii-travels-staging.iam.gserviceaccount.com`

**To switch it off:** run the deploy command with `ASSISTANT_ENABLED=false` in front of it.
The button disappears and new conversations are refused. Nothing else changes.

### Deploy again, after new code is merged

In Google Cloud Shell (<https://shell.cloud.google.com>):

```bash
git clone https://github.com/Hubert24hrs/suskii_travels_and_tours.git   # the first time only
cd suskii_travels_and_tours && git pull
bash scripts/gcp/deploy-vm.sh suskii-travels-staging
```

It builds the new images, runs the database step and starts the new containers. It takes
about 20 minutes and can be stopped and run again.

### Look at it

- The machine: <https://console.cloud.google.com/compute/instances?project=suskii-travels-staging>.
  The **SSH** button opens a terminal on it. `sudo docker ps` lists the containers and
  `sudo docker logs suskii-api-1` shows the API's log.
- The backups: <https://console.cloud.google.com/storage/browser/suskii-travels-staging-backups>.
- What it costs so far: <https://console.cloud.google.com/billing>. **A budget alert is set**
  for the project, `suskii-travels-staging-monthly`, at 50 US dollars a month: Google emails the
  billing account's admins at half, 90% and all of it, and when the month's forecast passes it.
  It warns and stops nothing. Change the amount under Budgets and alerts.

### Stop the costs

Stop the machine from the page above: the machine's own charge stops, and its disks and its
address still cost a few dollars a month. To remove everything, delete the project at
<https://console.cloud.google.com/cloud-resource-manager>.

### What changed in your Google account on 2026-11-12

- The project `suskii-travels-staging` was created and linked to the "Suskii Errands" billing
  account.
- That account was at Google's limit of five projects, so one had to give up its place. You
  chose `fast-delivery-d8d5c`. Its cloud functions are stopped until billing is linked to it
  again, and Google may delete its data after a time without billing. To link it again, free
  a place or ask Google for a higher limit
  (<https://support.google.com/code/contact/billing_quota_increase>), then open
  <https://console.cloud.google.com/billing/linkedaccount?project=fast-delivery-d8d5c>.
- Your `suskii-staging` and `suskii-prod` projects, which belong to your other Suskii app, were
  read and not changed.
- In `suskii-travels-staging`, later the same day: the Vertex AI, Cloud Billing and Billing
  Budgets services were switched on; a role with one permission, to call a Gemini model, was
  made and given to the machine and to the identity that builds the images; and the budget
  alert above was created on the "Suskii Errands" billing account, for this project only.
- For the mailbox (ADR-113): a fourth free name, `mail.endpoints.suskii-travels-staging.cloud.goog`,
  and the secret `MAILBOX_PASSWORD`, generated and never shown.

## The managed shape, for later

When the budget allows, the same images and the same keys move to Cloud Run, Cloud SQL and
Memorystore, with no change to the code.

```bash
bash scripts/gcp/deploy-backend.sh YOUR_PROJECT_ID
```

It creates the network, the managed database and cache, the documents bucket, the image
repository, one identity per service and every secret, builds the images, runs the database
step and rolls out the API, the worker and Ask Suskii's service. The first run takes about 40
minutes, most of it Google creating the database.

The data moves by restoring the last backup into the new database. The website and the admin
console come with your domain: browsers only keep a visitor signed in when the website and
the API share one (`infra/terraform/README.md`).

## If a deploy stops with an error

Run it again first: most stops are Google still finishing something. If it stops at the same
place twice, send the last 30 lines it printed. Nothing in them is secret.
