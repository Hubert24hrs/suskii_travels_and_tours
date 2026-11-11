-- Suskii Agent (ADR-107): what a staff agent prepared for a person to decide. Expand-only: one
-- new table and its type; the revision still serving reads neither.

-- CreateEnum
CREATE TYPE "AgentApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired', 'failed');

-- CreateTable
CREATE TABLE "agent_approvals" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "requested_by" UUID NOT NULL,
    "agent" VARCHAR(32) NOT NULL,
    "run_id" UUID NOT NULL,
    "conversation_id" UUID,
    "subject_type" VARCHAR(32),
    "subject_id" UUID,
    "payload" JSONB NOT NULL,
    "status" "AgentApprovalStatus" NOT NULL DEFAULT 'pending',
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reason" VARCHAR(40),
    "result_type" VARCHAR(32),
    "result_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_approvals_status_created_at_idx" ON "agent_approvals"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_approvals_requested_by_status_idx" ON "agent_approvals"("requested_by", "status");

