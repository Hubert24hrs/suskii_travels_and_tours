# Price intelligence

**Alert:** an operations email or a log line `operations alert` with kind `price-intel budget`
or `price-intel parser drift`; a site's request to stop reading it; a vendor's invoice above
what the console shows.
**Console:** Data sources (`GET /v1/admin/data-sources/overview`, `/jobs`, `/register`).
**Background:** ADR-102 (source policies, failover, guardrails).

Nothing here touches search, booking or payment: price intelligence only adds indicative
prices where no supplier has one, and switching it off loses only those.

## What happens automatically

- **A failed read** fails over inside the site's policy: once more one proxy class higher
  after a refusal, one retry after a timeout or a vendor error, a rendered read after an empty
  page, then the next vendor. It stops at 6 tries, 60 seconds or 5 cents, whichever comes
  first, and the answer is the last observations marked stale, or nothing.
- **A site that refuses** is read at half speed afterwards (recovering over 10 minutes per
  halving) and left alone for as long as its `Retry-After` says (5 minutes at most).
- **Breakers** open for a minute for a vendor on one site after 4 failures in a minute, and
  for a vendor everywhere after 8; a spent quota opens the vendor's breaker for 15 minutes or
  until its reset (an hour at most).
- **Budgets**: at a daily or monthly cap of a vendor or a site, nothing more is read for it
  until the period ends. Staff are told once at 50, 80 and 100%.
- **Drift**: when a site's pages stop yielding prices (5 or more reads in a day, and at least
  half of them), staff are told once and reads start at the recipe's second method.

## 1. A site asks us to stop, or counsel withdraws a basis

1. **Block the site**: Data sources, the site, Block (`POST /v1/admin/data-sources/{id}/block`).
   It takes effect at once on every replica; a blocked site is never read and answers nothing,
   not even what it said before.
2. If the request names a vendor's traffic rather than ours, block all the same and tell the
   vendor.
3. Record the request with counsel. The audit log has who approved the site, on which basis
   and with which reference (`price_intel.source_approved`).
4. Print the register for counsel: `pnpm --filter @suskii/api price-intel:register` as the
   `ops` job ([Deploy and roll back](deploy-and-rollback.md)).

Unblocking is two steps on purpose: back to review, then a new approval with a basis.

## 2. Something is wrong and reading must stop now

| Situation                                        | Action                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Unsure what is wrong                             | Stop everything: `POST /v1/admin/data-sources/switches/stop` with `{"scope":"global"}`            |
| One vendor misbehaves, overcharges or was leaked | Stop that vendor (`{"scope":"vendor","subject":"oxylabs"}`); rotate its key if it leaked          |
| One site                                         | Stop the site (`{"scope":"domain","subject":"example.com"}`), or block it when it should stay off |
| Feature-wide, for a long time                    | Unset `PRICE_INTEL_ENABLED` and redeploy                                                          |

A switch needs `datasources:manage` and no second check; it holds until someone releases it
(`switches/release`, which needs step-up). If Redis cannot be read, reads are refused: the
switches fail closed.

## 3. A budget alert

1. Overview shows spend against each cap. Is it one site, one vendor, or everything? "How
   reading has gone" on the same page (`GET /v1/admin/data-sources/health`) gives, for each
   vendor and site over the last day, three days or week, the tries, the share that gave a
   usable page, the share the site refused, and the cost per usable page and per price kept.
2. Jobs for the site (`/jobs?sourceId=`) show each read with its tries, classes and cost. Many
   `blocked` tries at the highest class mean the site is refusing us: lower its rate, or stop
   reading it and ask for an assisted quote path instead.
3. Raise a cap only with a reason (`PUT /v1/admin/data-sources/budgets`, step-up, audited). The
   vendor's own dashboard is the bill; the console's figure is our estimate from
   `PRICE_INTEL_COSTS` wherever the vendor does not report a cost.

## 4. A drift alert

1. Jobs for the site: the last `parse_failed` try has a kept page (7 days). The site changed
   its markup, or it now serves a challenge our page check did not recognise.
2. Write the new recipe version in the console and save. Saving closes the incident and reads
   start at the first method again. Nothing approves a recipe by itself. An incident nobody
   answers closes after 14 days and opens again if the pages still cannot be read.
3. If the page is a challenge, do not work around it: the policy's highest proxy class is the
   approver's decision, and raising it sends the site back to review.

## 5. Verify

A staff read from the console (Data sources, the site, Read) answers `read` with observations,
the overview shows the switch released and the vendor healthy, "How reading has gone" shows
the try as a usable page with the vendor's circuit closed, and no new alert arrives.

## Never

- Read a site that is not approved, or raise a proxy class to get past a refusal without a
  new approval.
- Add code that solves a challenge or hides who is reading.
- Put a vendor key in a site's settings, a chat or a ticket ([Key rotation](key-rotation.md)).
