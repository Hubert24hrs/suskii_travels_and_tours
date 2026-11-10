# ADR-103: Agent checkpoints as personal data, and what the agent reaches in the database

- Status: Accepted
- Date: 2026-11-10
- Deciders: Claude Code (implementer), pending owner review

## Context

LangGraph keeps a thread's state in a checkpointer so a conversation continues after a restart
and an interrupted run resumes. `PostgresSaver` stores it in PostgreSQL in tables it creates
itself with `setup()`: outside Prisma, outside the migration guard, and unknown to the data
registry that decides export, deletion and retention (ADR-029, ADR-039). A checkpoint holds what
was said in a conversation, so it is personal data.

The agent service must also not become a second way into application data (ADR-101).

## Decision

### One schema, one role

Checkpoints live in the same PostgreSQL instance, in a schema of their own, `agent`. The agent
service connects as `suskii_agent`: it may use that schema and read and write its rows, and
nothing else. It cannot see the `public` schema, create tables or schemas, or own anything. The
release step that creates and checks `suskii_app` (ADR-060) creates and checks this role the
same way, and refuses to finish if it can do more.

### The tables are migrated, not set up

The tables `PostgresSaver` needs are a checked-in SQL migration, copied from the pinned version
of the library and applied with every other migration by the schema owner. `setup()` is never
called outside tests. A test migrates a database our way, runs the library's `setup()` against
it and fails if that changed anything: a library upgrade that alters the tables then fails CI
until its migration is written. Prisma manages only `public`, so it leaves the schema alone, and
`pnpm check:migrations` reads the file like any other.

### What a checkpoint may hold

The conversation as the model saw it: text already scrubbed of contact details and document
numbers, tool results as facts under keys, and pending actions. It never holds a grant, a name,
a contact detail, a passport or payment value, or a raw page from price intelligence (ADR-105,
ADR-107).

### Retention, deletion and export

- `thread_id` is the conversation id. Deleting a conversation, deleting the account or the
  retention sweep deletes the thread's rows in every checkpoint table. The API does this as
  `suskii_app`, which is granted `DELETE` on those tables and nothing more in that schema.
- A thread ends after 30 days without a message and is purged (the retention rule
  `agent-threads`); the conversation's own messages follow the conversation's retention
  (ADR-105).
- The export gives the conversation from the API's tables, which hold the same words; checkpoint
  rows are working state and are not exported twice.
- Tables outside Prisma get the registry Prisma models have: `UNMANAGED_TABLES` names each table
  in the `agent` schema with its deletion and retention rule, and a test lists the schema's
  tables and fails on one that is missing.

### Connections

The API talks to PostgreSQL directly (node-postgres, `DATABASE_POOL_MAX`, no pooler in between),
so the saver's prepared statements and transactions need nothing special. The agent's pool is
small and capped (`AGENT_DATABASE_POOL_MAX`, default 5) and has a statement timeout; with the
service's instance limit this is counted in the instance's connection budget so agent load cannot
take the API's connections.

## Rejected

- **Letting the library create its tables at start-up.** The app role would need DDL, and the
  tables would appear without review.
- **A separate database for checkpoints.** One more instance to run, back up and delete from,
  for rows that belong to the same people.
- **Keeping checkpoints in Redis or memory.** A restart would lose a conversation mid-approval.

## Consequences

- A library upgrade that changes the checkpoint tables is a migration to write, caught by a test.
- Deleting an account now also deletes rows in a second schema; the deletion test covers it.
- One more database role and connection string (`AGENT_DATABASE_URL`) per environment.
