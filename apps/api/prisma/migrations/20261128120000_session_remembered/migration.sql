-- "Remember me" on sign-in (ADR-108): whether a session's cookies outlive the browser. Additive:
-- a new column with a default, so the revision still serving keeps working and every session
-- that exists stays remembered, as it was.

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN "remembered" BOOLEAN NOT NULL DEFAULT true;
