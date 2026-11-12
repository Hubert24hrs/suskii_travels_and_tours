# ADR-110: The backend on Google Cloud before the domain and the edge exist

- Status: Accepted
- Date: 2026-11-12
- Deciders: the owner (asked for the backend and the assistant's backend to be deployed on
  Google's services, done for them), Claude Code (implementer)
- Amends: ADR-059 (the topology gains a second shape), ADR-060 (who applies Terraform)

## Context

The owner asked for the backend to go live on Firebase, GCP or Google Cloud services, with the
assistant's backend beside it, "on the same backend" but without the platform misbehaving when
anything about the assistant goes wrong.

What existed (ADR-059, ADR-060): Terraform for one environment behind Cloudflare. A load
balancer that only Cloudflare may reach serves the website, the console and the API on the
owner's domain. An operator applies it; the pipelines only roll out images. It needs two
things the owner does not have yet: a domain with a Cloudflare zone, and a workstation with
Terraform and credentials.

Two facts shaped the answer:

- The website and the console sign people in with cookies that the API sets. Browsers treat
  the API and the website as one site only when they share a registrable domain. Two
  `run.app` addresses do not, so cookies would be third-party and Safari would drop them. The
  website and the console therefore need the domain. The app does not: it signs in with
  tokens and can call any address.
- This session holds no Google credential, and should not: the owner's project is the
  owner's. Whatever is built has to be run by the owner, with as little typing as possible.

## Decision

### Google Cloud, not Firebase, for the backend

The backend is a NestJS API with PostgreSQL, Redis, queues and a separate agent service. That
is Cloud Run, Cloud SQL and Memorystore, which the repository already targets. Firebase's
backend products (Firestore, Functions) would mean rewriting the data layer and the money
code for a document store, for no gain. Firebase stays what it is good at here: push
notifications to Android (FCM, ADR-022).

### A second shape of the same platform module: `edge = "none"`

`modules/platform` takes `edge`: `cloudflare` (the default, ADR-059, unchanged) or `none`.
Without the edge:

- no load balancer, certificates, Cloud Armor policy or Cloudflare records;
- the API's Cloud Run service accepts traffic from anywhere on its own `run.app` address,
  with Google's certificate. It is the only public door;
- the worker and the agent service stay reachable from the VPC only, exactly as behind the
  edge;
- the website and the console are not created;
- the API learns the caller's address from one trusted hop of `X-Forwarded-For` (Google's
  front end appends it) instead of Cloudflare's header, and knows no country.

Everything else is the same code: network, NAT with fixed outbound addresses, Cloud SQL with a
private address, Memorystore with TLS, the documents bucket, Artifact Registry, one identity
per service, Secret Manager, the migration job, the ops job, Workload Identity Federation for
later pipeline deploys.

`infra/terraform/backend/` is the root for it. Every variable has a default but the project,
and it starts on the stand-ins for suppliers, payments, email and texts
(`allow_mock_providers`), as staging was always meant to (ADR-059). Real providers are a
setting and a key away each, and none of them needs a redeploy of anything but the API.

Moving to the full shape later is a change of root, not a rebuild: the same project and state
are applied from `live/` with the domain's values, which adds the load balancer and the edge
and closes the API's public door.

### The assistant beside the backend, and unable to hurt it

"The same backend" is the same project, network, database server and API. "Cannot make the
platform misbehave" is the isolation that ADR-101 to ADR-107 built, which this deployment
keeps whole:

- **Its own service.** The agent service is a separate Cloud Run service with its own
  identity, scaling and memory. A crash, a slow model or a runaway conversation uses its
  instances, never the API's.
- **Its own corner of the database.** Its role sees one schema (`agent`, checkpoints) and
  nothing of `public`. It cannot read or lock a booking, a payment or a ledger row.
- **One way in to the platform.** It calls the API's tool gateway with its own token, as the
  traveller of the conversation, through tools that return facts. It holds no supplier or
  payment key.
- **Nothing waits for it.** No search, booking or payment route calls the assistant. The
  off-mode suite runs the booking journeys with the assistant absent on every change.
- **Bounded.** A run has a step limit, a tool-call limit, a time limit and a reserved spend;
  there are daily caps per traveller, per guest address and in total; the pause switch stops
  every run at once and fails closed.
- **One switch.** `assistant_enabled = false` (the API's `AGENT_ENABLED`) removes the button
  from the clients and refuses new runs. Nothing else changes.

It starts when someone opens a conversation (`min = 0`) and the API keeps one instance warm.

### Run by the owner in Cloud Shell, in one command

`scripts/gcp/deploy-backend.sh <project>` does the whole deployment from Google Cloud Shell,
where the owner is already signed in and `gcloud`, `git` and Node are installed:

1. checks the project and that billing is on;
2. fetches Terraform at the pinned version and checks its checksum;
3. creates the state bucket and applies the foundations;
4. gives every secret a value: generated ones go from the process straight into Secret
   Manager and are never printed or written to disk (`seed-secrets.mjs`), and the Gemini key is
   asked for with a hidden prompt, or skipped;
5. creates the services, then tells the API the agent service's address (two applies, because
   the two name each other);
6. builds the four images with Cloud Build, as a build identity that can read its source,
   write to the image repository and write logs, and nothing else;
7. runs the migration job and rolls out the API, the worker and the agent service;
8. checks `/health`, `/ready`, `/v1/status` and `/v1/agent/status`, and prints the API's
   address.

It can be stopped and run again: each step looks at what exists. What it decided is kept in
one small file in the state bucket (the stage reached, the agent's address, the model), which
holds no secret.

This amends ADR-060 in one place: for this shape the owner applies Terraform through the
script, not an operator from a workstation, and the first images come from Cloud Build, not
the signed release pipeline. Later deploys can use the pipeline: the script prints the values
its GitHub environment needs. Production behind the edge keeps ADR-060 as written, signed
images included.

## Consequences

- The app can be pointed at a real, lasting backend as soon as the owner has a project with
  billing. The hosted test server (ADR-066), rebuilt every few hours, is no longer the only
  place to try a build.
- There is no website or console on this backend yet. The first super admin and other
  operator commands run through the ops job (`gcloud run jobs execute`).
- The API is public without a WAF in front. It keeps its own defences (rate limits, device
  attestation, input validation, audit), and this shape is for staging on stand-ins. Taking
  real money goes with the domain and the edge.
- Cost starts with the first apply. The smallest sizes are chosen; the database, the cache,
  the NAT and one warm API instance are the bulk of it.
- The script has been checked for syntax and its Terraform for format; `terraform validate`
  and TFLint run in CI. It has not been run against a project: this session has no Google
  credential. The first run is the test, and it is built to be run again after a fix.

## Alternatives considered

- **Wait for the domain and apply `live/`.** Correct for production, and blocked today.
- **The website and the console on `run.app` too.** Sign-in would fail in browsers that drop
  third-party cookies. Not worth shipping.
- **Give this session the owner's Google credentials.** A long-lived key would have to be
  pasted into a chat or a repository secret. The owner running one command is safer and no
  slower.
- **GitHub Actions applies Terraform.** It needs an identity with owner-like rights reachable
  from a workflow. Reasonable later, with an environment protected by a reviewer; not as the
  first thing in a new project.
- **Firebase for the backend.** A rewrite, see above.
