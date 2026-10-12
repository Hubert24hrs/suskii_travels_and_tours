# Database restore

**Alert:** `DatabaseConnectionsHigh` (above 80% of the connection limit). Also use this runbook
for data loss, corruption, or a migration that damaged data.
**Background:** ADR-017 (ledger), ADR-038 (TLS), ADR-039 (retention). The managed database,
its point-in-time recovery and backup schedule arrive with phase 12. The logical restore below
works on any PostgreSQL 16.

## Ground rules

- **Never restore over the live database, and never run `prisma migrate reset` against it.**
  Restore into a new database or instance, verify it, then switch the application over.
- Stop writes before switching: scale the worker to zero, then put the API in maintenance (scale
  to zero or block at the edge). Payment providers retry webhooks for hours, so nothing is lost
  while the API is down for a short time.
- Write down the restore point (UTC) in the incident record. Everything after it must be
  reconciled.

## Connection exhaustion (`DatabaseConnectionsHigh`)

1. See who holds the connections:

   ```sql
   SELECT application_name, state, count(*), max(now() - state_change) AS oldest
   FROM pg_stat_activity WHERE datname = current_database()
   GROUP BY 1, 2 ORDER BY 3 DESC;
   ```

2. `idle in transaction` sessions older than a minute are a leak or a stuck request. End them
   with `SELECT pg_terminate_backend(pid) ...`, then find the request id in the logs and open
   an issue.
3. Too many replicas for the pool? Each API replica opens up to `connection_limit` (on
   `DATABASE_URL`) connections. The sum over replicas, plus the worker and migrations, must stay
   under `max_connections`. Lower the pool or the replica count before raising the limit.
4. A slow query holding connections: `pg_stat_activity.query` shows it (parameters are not
   logged). Check that its indexes exist (`EXPLAIN`).

## Restore

### 1. Choose the source

| Situation                                             | Source                                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Lost or corrupted data, known time                    | Point-in-time recovery of the managed database to just before the event                     |
| A bad migration                                       | Fix forward with a new migration if the data can be derived; else PITR to before the deploy |
| A whole instance lost                                 | Latest backup or PITR to the latest point                                                   |
| Rehearsal, or copying data to an isolated environment | `pg_dump` of the source (below)                                                             |

### 2. Restore into a new database

With a managed service, restore to a **new instance** at the chosen time from its console or
CLI. For a logical restore:

```bash
# Dump (custom format, no owners or grants so it restores under any role).
pg_dump --format=custom --no-owner --no-acl --file=suskii.dump "$SOURCE_URL"

# Restore into a database that did not exist before.
psql "$SERVER_URL/postgres" -c 'CREATE DATABASE suskii_restore_YYYYMMDD'
pg_restore --no-owner --no-acl --exit-on-error --jobs=4 \
  --dbname="$SERVER_URL/suskii_restore_YYYYMMDD" suskii.dump
```

Dumps contain personal data and encrypted fields. Keep them only on encrypted storage the
incident needs, and delete them afterwards.

### 3. Verify before switching

```bash
# Schema matches the code (no pending or failed migrations).
DATABASE_URL="$RESTORED_URL" pnpm --filter @suskii/api exec prisma migrate status
```

```sql
-- Append-only and ledger protections came back (expect 7 triggers).
SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal;
-- Every ledger transaction balances (expect 0).
SELECT count(*) FROM (
  SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
  HAVING sum(CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) <> 0
) unbalanced;
-- Spot-check recent rows against what you expect at the restore point.
SELECT max(created_at) FROM bookings;
SELECT max(occurred_at) FROM audit_log;
```

Then start one API instance against the restored database, away from traffic, and check that
`/ready` reports the database and Redis as up and that a read such as
`/v1/catalog/airports/LOS` answers.

The field encryption key must be the one in use at the restore point. If a key rotation
happened after it, keep the old key in `FIELD_ENCRYPTION_PREVIOUS_KEYS`.

### 4. Switch over

1. Point `DATABASE_URL` at the restored database in the secret manager.
2. Start the API, then the worker.
3. Watch `/ready`, error rates and the ticketing backlog for 15 minutes.
4. Keep the old database, renamed and not written to, until the review is done. Then delete it
   following the retention policy.

### 5. Reconcile the gap

Data written after the restore point is gone from the database but may exist elsewhere:

- **Payments:** list provider transactions since the restore point in each provider's dashboard.
  Webhooks that arrive again are applied normally. A payment for a booking the database no
  longer has is not applied; finance refunds it from the provider dashboard and records it.
- **Supplier orders:** list the supplier's orders since the restore point and match them to
  bookings. Unknown orders: cancel them with the supplier or rebuild the booking with
  engineering.
- **Accounts:** people who signed up or changed passwords after the restore point need to do
  it again. Support explains.
- **Object storage:** documents uploaded after the restore point are orphaned. The retention
  job does not see them; delete them under the bucket's lifecycle rule.
- **Redis** holds caches, rate limits, codes and the session denylist. Revocations are also in
  the database, so nothing there needs restoring.

## Drill record

Rehearse at least once a quarter and after any change to the schema protections.

| Date       | Source                                                                                           | Size   | Dump and restore | Checks                                                                                                                                                                                                                                 | By          |
| ---------- | ------------------------------------------------------------------------------------------------ | ------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2026-10-12 | Local development database (13 migrations, 70 tables, seeded reference data and sample bookings) | 0.8 MB | 3 s              | Row counts identical in all 70 tables; 7 triggers present; `audit_log` refused an `UPDATE`; `migrate status` up to date; ledger balanced; API `/ready` up and catalog reads answered against the restored copy; drill database dropped | Claude Code |

The first production-sized drill belongs to phase 12, with the managed database's
point-in-time recovery. Record the time to restore against the recovery objectives the owner
sets.
