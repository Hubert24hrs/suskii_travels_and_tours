# Put the backend on Google Cloud

One command, run by you in Google Cloud Shell, puts the API, the worker and the assistant's
service (Ask Suskii) on Google Cloud. It takes about 40 minutes the first time, most of it
Google creating the database. You can stop it and run it again at any point.

Why you run it and not the assistant that wrote it: it creates things in your Google account
and starts costs on your card. No copy of your Google password or key exists anywhere else.

## Before you start

1. **A Google Cloud project with billing switched on.** Create one at
   <https://console.cloud.google.com/projectcreate> (any name; note the **project ID** under
   it, for example `suskii-staging-123456`). Then link a billing account:
   <https://console.cloud.google.com/billing>.
2. **Optional: a Gemini API key**, so Ask Suskii answers with Google Gemini from the first
   minute. Create it at <https://aistudio.google.com/apikey>, on the same project. Without it
   the assistant answers with a built-in stand-in and you can add the key later.

That is all. No domain, no Cloudflare, no other account.

## Run it

1. Open Cloud Shell: <https://shell.cloud.google.com>
2. Paste this, with your project ID in place of `YOUR_PROJECT_ID`, and press Enter:

   ```bash
   git clone https://github.com/Hubert24hrs/suskii_travels_and_tours.git
   cd suskii_travels_and_tours
   bash scripts/gcp/deploy-backend.sh YOUR_PROJECT_ID
   ```

3. When it asks for the Gemini key, paste it (nothing shows as you paste) or press Enter.
4. Keep the tab open. If Cloud Shell disconnects, open it again and run the last line again
   from inside `suskii_travels_and_tours`: it carries on where it stopped.

When it finishes it prints the API's address and four lines to send back. Send them, and the
app's test build is pointed at this backend.

## What you get

- **The API** on its own `https://…run.app` address, with Google's certificate.
- **The worker**, which refreshes fares and deals and sends reminders. Not reachable from
  outside.
- **The assistant's service**, not reachable from outside. It is separate from the API on
  purpose: if a model is slow, wrong or down, searching, booking and paying carry on. One
  setting switches it off (the script prints the command).
- **PostgreSQL** (Cloud SQL) and **Redis** (Memorystore), both with private addresses only.
- **A private bucket** for tickets and documents, **Secret Manager** for every key (generated
  for you, never shown), and an **image repository**.

It runs on the built-in stand-ins for airlines, hotels, payments, email and texts, so every
journey works and no real money moves. Each real provider is connected later with its key.

There is no website or admin console on it yet. Those need your domain: browsers only keep a
visitor signed in when the website and the API share one. When the domain exists, the same
project grows the load balancer and the Cloudflare edge (`infra/terraform/README.md`).

## What it costs

Billing starts when the script creates the database. With the sizes it uses (the smallest that
are sound), expect roughly 150 to 250 US dollars a month: the database and the cache are
about half, the fixed outbound address and one always-warm API instance most of the rest.
These are estimates from Google's list prices, not a quote: check
<https://cloud.google.com/products/calculator> for your region, and set a budget alert at
<https://console.cloud.google.com/billing/budgets> before you run it.

To stop the costs, delete the project (<https://console.cloud.google.com/cloud-resource-manager>).
The database is protected against deletion by Terraform on purpose; deleting the project is
the one step that removes everything.

## Afterwards

- **New code.** In Cloud Shell: `cd suskii_travels_and_tours && git pull`, then the same
  command. It builds and rolls out what changed.
- **Your first admin account.** After you sign up in the app:

  ```bash
  gcloud run jobs execute suskii-staging-ops --region europe-west2 --wait \
    --args=scripts/staff-bootstrap.ts,--email,YOU@example.com,--yes
  ```

- **Switch the assistant off or on.** The script prints the command. Off removes the button
  from the app and refuses new conversations; nothing else changes.
- **Logs.** <https://console.cloud.google.com/run> and choose a service.

## If it stops with an error

Run it again first: most stops are Google still finishing something. If it stops at the same
place twice, send the last 30 lines it printed. Nothing in them is secret.
