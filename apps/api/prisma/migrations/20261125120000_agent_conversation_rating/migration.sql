-- A traveller's rating of a conversation with the assistant (ADR-106): two new nullable
-- columns; nothing existing changes.
-- AlterTable
ALTER TABLE "agent_conversations" ADD COLUMN "rating" SMALLINT,
ADD COLUMN "rated_at" TIMESTAMPTZ(3);
