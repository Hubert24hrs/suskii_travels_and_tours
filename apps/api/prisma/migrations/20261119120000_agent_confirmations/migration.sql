-- Suskii Agent (ADR-107): what a traveller is asked to confirm before a commit runs. Expand-only:
-- one new table and its type; the revision still serving reads neither.

-- CreateEnum
CREATE TYPE "AgentConfirmationStatus" AS ENUM ('pending', 'confirmed', 'declined', 'expired', 'failed');

-- CreateTable
CREATE TABLE "agent_confirmations" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent" VARCHAR(32) NOT NULL,
    "tool" VARCHAR(64) NOT NULL,
    "arguments" JSONB NOT NULL,
    "card" JSONB NOT NULL,
    "expected" JSONB,
    "status" "AgentConfirmationStatus" NOT NULL DEFAULT 'pending',
    "reason" VARCHAR(40),
    "result" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_confirmations_conversation_id_id_idx" ON "agent_confirmations"("conversation_id", "id");

-- CreateIndex
CREATE INDEX "agent_confirmations_user_id_status_idx" ON "agent_confirmations"("user_id", "status");

-- AddForeignKey
ALTER TABLE "agent_confirmations" ADD CONSTRAINT "agent_confirmations_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One confirmation waits per conversation at a time: a second ask while one is pending is a bug.
CREATE UNIQUE INDEX "agent_confirmations_one_pending_idx" ON "agent_confirmations"("conversation_id") WHERE "status" = 'pending';
