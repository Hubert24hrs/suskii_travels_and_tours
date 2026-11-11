# What the assistant and price intelligence would cost a month

**These are estimates, not invoices and not quotes.** Nothing here has been billed: no model
has answered a traveller, no web-data vendor has been called and nothing is deployed. The
figures are arithmetic on stated assumptions, so that the owner can see the order of magnitude
and which assumption moves it. Replace each assumption with a measured figure as soon as there
is one. The invoices of the model provider, the vendors and Google Cloud are the actual cost.

Written on 2026-11-11 for sub-phase H of the Suskii Agent (`docs/phases/ai-agent.md`). All
amounts are US dollars a month.

## Summary

| Monthly customers | The assistant's model calls                  | Staff agents | Reading other sites (usage) | Infrastructure added | Together, base case                       |
| ----------------- | -------------------------------------------- | ------------ | --------------------------- | -------------------- | ----------------------------------------- |
| 5,000             | about $190 (from about $60 to about $375)    | about $25    | about $7 (from $2 to $18)   | about $50 to $100    | about $270 to $320, plus vendor plan fees |
| 20,000            | about $750 (from about $250 to about $1,500) | about $55    | about $29 (from $7 to $72)  | about $50 to $100    | about $885 to $935, plus vendor plan fees |

Not in the table, because nothing here can estimate them:

- **Vendor plan fees.** The web-data vendors sell monthly plans, some with a minimum. The usage
  figures above are what the pages would cost at the per-page estimates in the code. What a
  vendor charges at least each month is on its own pricing page, and the owner reads it when
  choosing which vendors to open accounts with. One or two vendors are enough to start.
- **People.** Someone verifies each assisted quote with a supplier, books it by hand and works
  the approvals queue. That time is the larger cost of selling a price seen on another site,
  and it grows with the number of requests.
- **The other two AI features** have their own caps and are not part of this estimate: AI trip
  search (at most $20 a day by default) and the after-hours support assistant (at most $5 a
  day by default).

## What limits the cost, whatever the estimate says

These are settings in force in the code, not estimates:

| Limit                                              | Default          | So the most a month can cost |
| -------------------------------------------------- | ---------------- | ---------------------------- |
| The assistant, everyone together, a day            | $50              | $1,550 (31 days)             |
| One signed-in person, a day                        | $0.50            |                              |
| One guest address, a day                           | $0.12            |                              |
| One run (reserved before its first model call)     | $0.06            |                              |
| Candidate prompts in the shadow, a day (off today) | $2               | $62                          |
| One web-data vendor, a day and a month             | $5 and $50       | $50 a vendor                 |
| One site, a day and a month                        | $2 and $20       | $20 a site                   |
| One read of a site                                 | $0.05, six tries |                              |

At a cap nothing more is spent: no run starts, or nothing more is read, and the ordinary
screens keep working. The owner can also set a monthly figure (`AGENT_MONTHLY_ALERT_MICROUSD`):
operations are told once when the month is heading past it and once when it is past it. That
figure only tells; the daily cap is what stops spending.

In the high case at 20,000 customers the estimate ($1,500 and the staff agents) reaches the
default daily cap on busy days. The cap would then stop new conversations for the rest of
such a day. Raising it (`AGENT_GLOBAL_DAILY_MICROUSD`) is the owner's decision.

## 1. The assistant's model calls

### Prices assumed

The prices configured in the code for the default models, read from the provider's price list
on 2026-11-10 (`DEFAULT_AGENT_MODEL_PRICES`; the owner confirms them against the current list
and sets `AGENT_MODEL_PRICES` when they change):

| Model, and what it does                              | Input, a million tokens | Output, a million tokens | Cached input, a million tokens |
| ---------------------------------------------------- | ----------------------- | ------------------------ | ------------------------------ |
| Claude Haiku 5.5: routes a message, and the fallback | $0.10                   | $0.50                    | $0.01                          |
| Claude Sonnet 5.5: writes the answer                 | $2.00                   | $10.00                   | $0.10                          |

### What one answered message uses

Measured from the code: an agent's instructions and the definitions of its tools are between
8,000 and 21,000 characters for the travellers' agents (13,000 on average) and are sent with
every model call of a run. Counted at four characters a token, that is about 3,200 tokens.
The four-characters rule is an approximation; a model's own count can be higher.

Assumed, because no real conversation exists yet: 1,500 tokens of earlier conversation, 1,000
tokens for what a tool returns, 70 tokens for a tool call and 220 for an answer.

| A message that needs                     | Model calls | Input tokens | Output tokens | Cost   | With the fixed part cached |
| ---------------------------------------- | ----------- | ------------ | ------------- | ------ | -------------------------- |
| No tool (a greeting, a general question) | 1           | 4,760        | 220           | $0.012 | $0.006                     |
| One tool (a search, a booking's status)  | 2           | 10,590       | 290           | $0.024 | $0.012                     |
| Three tools (planning a trip)            | 4           | 25,460       | 430           | $0.055 | $0.031                     |

Routing adds less than a hundredth of a cent. Assuming three messages in ten need no tool,
fifty-five in a hundred one tool and fifteen in a hundred three:

- **$0.025 a message** without caching. This is the figure used below.
- about $0.013 a message if the provider's prompt cache serves the fixed part on every call.
  The code asks for it; whether it applies depends on the provider's minimum size for a cached
  prompt and on calls arriving within its window, so it is not counted on.

A staff agent has fewer tools and shorter instructions: about $0.014 a message.

### How many messages

A monthly customer is a person who uses the website or the app in a month. Assumed: a person
who uses the assistant sends 10 messages a month (two conversations of five).

| Monthly customers | Share who use the assistant | Messages a month | At $0.025 | If caching applies |
| ----------------- | --------------------------- | ---------------- | --------- | ------------------ |
| 5,000             | 5% (low)                    | 2,500            | $63       | $35                |
| 5,000             | 15% (base)                  | 7,500            | $188      | $105               |
| 5,000             | 30% (high)                  | 15,000           | $375      | $210               |
| 20,000            | 5% (low)                    | 10,000           | $250      | $140               |
| 20,000            | 15% (base)                  | 30,000           | $750      | $420               |
| 20,000            | 30% (high)                  | 60,000           | $1,500    | $840               |

Staff agents, assuming 15 messages a working day each over 22 days: 5 people (1,650 messages)
about $23; 12 people (3,960 messages) about $55.

### What moves it most

1. **The share of customers who use the assistant.** Unknown until it is offered. The base
   case is an assumption, not a forecast.
2. **The answering model.** Answering with Haiku 5.5 instead of Sonnet 5.5 would cost a
   twentieth at the prices above. That is arithmetic on the price list, not a statement about
   quality: a model answers travellers only after the three evals pass against it (ADR-106).
3. **How much each tool returns.** A search that returns ten options instead of five costs
   more on every later call of the run.
4. **Caching.** See above.

The assistant on WhatsApp is off unless set and is not counted. If it is switched on, each
inbound message is a run as above, and Meta bills its own messages.

## 2. Reading other sites (price intelligence)

Nothing is read today: every site starts in review, none is approved, and production has the
feature off. The estimate is for after the owner and counsel have approved sites.

### Prices assumed

The per-page estimates in the code (`DEFAULT_SCRAPE_COSTS`), which exist to make budgets stop
reading and are not the vendors' quotes: from $0.001 to $0.01 a page depending on the vendor
and on how the page is fetched. A blended $0.004 a page is used below. The owner replaces them
with the plan prices (`PRICE_INTEL_COSTS`) once accounts exist.

### How many pages

Assumed: 3 in 100 monthly customers ask once a month for a price no supplier sells; each
question is read on two approved sites; each read takes 1.5 tries on average (six at most);
and each question is read again on three later nights while it is still wanted (the nightly
sweep re-reads at most ten questions a site).

| Monthly customers | Questions | Pages fetched | At $0.004 | At $0.001 to $0.01 |
| ----------------- | --------- | ------------- | --------- | ------------------ |
| 5,000             | 150       | 1,800         | $7        | $2 to $18          |
| 20,000            | 600       | 7,200         | $29       | $7 to $72          |

With two approved sites the default budgets stop reading at $40 a month whatever happens. An
answer that is still fresh is reused and costs nothing.

## 3. Infrastructure added

The assistant adds one service to the platform; everything else it uses is already there.

| What                               | Size                                                                                                     | Estimate                                        |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| The agent service (Cloud Run)      | 1 vCPU and 1 GiB; in production one instance kept warm, five at most; one instance takes 20 runs at once | about $50 to $100 a month for the warm instance |
| The agent service in staging       | No instance kept warm, one at most                                                                       | close to nothing while unused                   |
| Its working state (checkpoints)    | A schema in the existing database; a conversation's state is purged after 30 idle days                   | storage only; small                             |
| Run events                         | In the existing Redis, short-lived                                                                       | none added                                      |
| Kept pages and knowledge documents | In the existing bucket: pages for 7 days, documents up to 512 KB each and 200 in use                     | small                                           |
| Traffic to the model provider      | Text only, through the existing NAT                                                                      | small                                           |

One instance is enough at both sizes: in the high case at 20,000 customers, 60,000 messages a
month are about 2,000 a day, and a run lasts seconds, so fewer than one run is in flight on
average even in a busy hour. The service scales out by itself if that is wrong.

**The unit prices behind "$50 to $100" could not be confirmed while writing this.** Google's
price page could not be read from the build environment. The range comes from one instance
for a whole month (730 hours of 1 vCPU and 1 GiB) at between $0.000018 and $0.000024 a
vCPU-second and between $0.000002 and $0.0000025 a GiB-second, which gives $53 to $70, widened
because London (`europe-west2`) is priced above Google's cheapest regions. An instance that is
warm but idle may be billed at a lower rate than this assumes. Use Google's pricing calculator
with the sizes in the table before relying on the figure.

Nothing is deployed and Terraform has not been applied: the first real figure is the first
month's bill after the owner applies it.

## How to replace these estimates with measurements

1. **After the first run of the agent evals with the owner's key** (Actions, Agent evals): each
   suite prints the calls and the tokens each model used over its cases. Divided by the number
   of cases, that is the first real measurement of what a message uses.
2. **After the first week with real conversations:** Console, Assistant cost and quality, shows
   the estimated cost by day, by agent, by model and by channel, the accounts that cost most,
   and a forecast for the month. Those figures are still estimates (reported tokens at the configured prices);
   compare them with the provider's invoice.
3. **After the first month with approved sites:** Console, Data sources, "How reading has
   gone" shows the cost per usable page and per price kept, for each vendor and site. Compare
   it with each vendor's dashboard, which is the bill.
4. **Set the monthly figure** (`AGENT_MONTHLY_ALERT_MICROUSD`) once the first month is known,
   a little above what the month is expected to cost.
