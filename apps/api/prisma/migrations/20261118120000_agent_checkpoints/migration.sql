-- Agent checkpoints (ADR-103): the tables LangGraph's PostgresSaver keeps a thread's state in,
-- in a schema of their own. They are copied from @langchain/langgraph-checkpoint-postgres 1.1.2
-- (its migrations 0 to 5, in their final shape) and recorded as applied, so the library's own
-- set-up finds nothing to do. `test/agent-checkpoints.e2e-spec.ts` runs that set-up against a
-- database migrated this way and fails if it changes anything: a library upgrade that alters
-- these tables needs a migration here first.
--
-- Prisma manages only `public` and leaves this schema alone. The roles are granted their rights
-- by the release step (src/infra/app-role.ts): `suskii_agent` reads and writes these rows and
-- sees nothing else; the API's role may only delete a thread's rows.

CREATE SCHEMA IF NOT EXISTS "agent";

CREATE TABLE "agent"."checkpoint_migrations" (
    "v" INTEGER PRIMARY KEY
);

CREATE TABLE "agent"."checkpoints" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "parent_checkpoint_id" TEXT,
    "type" TEXT,
    "checkpoint" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id")
);

CREATE TABLE "agent"."checkpoint_blobs" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "channel" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "blob" BYTEA,
    PRIMARY KEY ("thread_id", "checkpoint_ns", "channel", "version")
);

CREATE TABLE "agent"."checkpoint_writes" (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT,
    "blob" BYTEA NOT NULL,
    "task_path" TEXT NOT NULL DEFAULT '',
    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "idx")
);

INSERT INTO "agent"."checkpoint_migrations" ("v") VALUES (0), (1), (2), (3), (4), (5);
