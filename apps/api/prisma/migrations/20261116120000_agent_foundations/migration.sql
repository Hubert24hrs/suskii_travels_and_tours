-- Suskii Agent (ADR-101 to ADR-107): conversations with the assistant, what each run did and
-- cost, and the settings staff control it with. Expand-only: five new tables and their types;
-- the revision still serving reads none of them.

-- CreateEnum
CREATE TYPE "AgentConversationStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "AgentMessageRole" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('running', 'waiting', 'succeeded', 'failed', 'cancelled', 'refused');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('ok', 'denied', 'error', 'timeout');

-- CreateEnum
CREATE TYPE "AgentFeedback" AS ENUM ('up', 'down');

-- CreateTable
CREATE TABLE "agent_conversations" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "user_id" UUID,
    "access_token_hash" TEXT,
    "audience" VARCHAR(16) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "locale" VARCHAR(12) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "country" CHAR(2),
    "status" "AgentConversationStatus" NOT NULL DEFAULT 'open',
    "booking_id" UUID,
    "handover_conversation_id" UUID,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "AgentMessageRole" NOT NULL,
    "agent" VARCHAR(32),
    "kind" VARCHAR(24) NOT NULL DEFAULT 'text',
    "body_encrypted" TEXT NOT NULL,
    "parts" JSONB,
    "sources" JSONB,
    "run_id" UUID,
    "feedback" "AgentFeedback",
    "feedback_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "conversation_id" UUID,
    "audience" VARCHAR(16) NOT NULL,
    "channel" VARCHAR(16) NOT NULL,
    "agent" VARCHAR(32) NOT NULL,
    "agents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trigger" VARCHAR(16) NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'running',
    "outcome" VARCHAR(40),
    "model_provider" VARCHAR(32),
    "model" VARCHAR(64),
    "prompt_version" VARCHAR(32),
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "tool_call_count" INTEGER NOT NULL DEFAULT 0,
    "trace_id" VARCHAR(32),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_calls" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "agent" VARCHAR(32) NOT NULL,
    "tool" VARCHAR(64) NOT NULL,
    "tier" VARCHAR(12) NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL,
    "reason" VARCHAR(40),
    "argument_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversations_reference_key" ON "agent_conversations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversations_access_token_hash_key" ON "agent_conversations"("access_token_hash");

-- CreateIndex
CREATE INDEX "agent_conversations_user_id_last_message_at_idx" ON "agent_conversations"("user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "agent_conversations_last_message_at_idx" ON "agent_conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "agent_conversations_audience_status_last_message_at_idx" ON "agent_conversations"("audience", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "agent_messages_conversation_id_id_idx" ON "agent_messages"("conversation_id", "id");

-- CreateIndex
CREATE INDEX "agent_runs_conversation_id_id_idx" ON "agent_runs"("conversation_id", "id");

-- CreateIndex
CREATE INDEX "agent_runs_status_started_at_idx" ON "agent_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "agent_runs_started_at_idx" ON "agent_runs"("started_at");

-- CreateIndex
CREATE INDEX "agent_tool_calls_run_id_id_idx" ON "agent_tool_calls"("run_id", "id");

-- CreateIndex
CREATE INDEX "agent_tool_calls_tool_created_at_idx" ON "agent_tool_calls"("tool", "created_at");

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_handover_conversation_id_fkey" FOREIGN KEY ("handover_conversation_id") REFERENCES "support_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "agent_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_calls" ADD CONSTRAINT "agent_tool_calls_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
