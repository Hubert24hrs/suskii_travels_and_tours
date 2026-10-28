-- Support conversations and messages (ADR-083); a new notification category for replies.
-- CreateEnum
CREATE TYPE "SupportCategory" AS ENUM ('pre_booking', 'booking_change', 'cancellation_refund', 'payment', 'documents', 'general');

-- CreateEnum
CREATE TYPE "SupportStatus" AS ENUM ('open', 'waiting', 'resolved');

-- CreateEnum
CREATE TYPE "SupportPriority" AS ENUM ('urgent', 'prime', 'normal');

-- CreateEnum
CREATE TYPE "SupportChannel" AS ENUM ('web', 'app', 'whatsapp');

-- CreateEnum
CREATE TYPE "SupportAuthor" AS ENUM ('customer', 'staff', 'system');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'support';

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "user_id" UUID,
    "access_token_hash" TEXT,
    "email_encrypted" TEXT,
    "booking_id" UUID,
    "channel" "SupportChannel" NOT NULL,
    "category" "SupportCategory" NOT NULL,
    "priority" "SupportPriority" NOT NULL,
    "status" "SupportStatus" NOT NULL DEFAULT 'open',
    "assignee_id" UUID,
    "opened_at" TIMESTAMPTZ(3) NOT NULL,
    "reply_owed_since" TIMESTAMPTZ(3),
    "response_due_at" TIMESTAMPTZ(3),
    "resolution_due_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "first_responded_at" TIMESTAMPTZ(3),
    "last_customer_message_at" TIMESTAMPTZ(3) NOT NULL,
    "last_staff_message_at" TIMESTAMPTZ(3),
    "customer_read_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author" "SupportAuthor" NOT NULL,
    "staff_id" UUID,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "body_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_reference_key" ON "support_conversations"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_access_token_hash_key" ON "support_conversations"("access_token_hash");

-- CreateIndex
CREATE INDEX "support_conversations_status_due_at_id_idx" ON "support_conversations"("status", "due_at", "id");

-- CreateIndex
CREATE INDEX "support_conversations_user_id_updated_at_idx" ON "support_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "support_conversations_assignee_id_status_idx" ON "support_conversations"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "support_conversations_booking_id_idx" ON "support_conversations"("booking_id");

-- CreateIndex
CREATE INDEX "support_conversations_status_updated_at_idx" ON "support_conversations"("status", "updated_at");

-- CreateIndex
CREATE INDEX "support_messages_conversation_id_id_idx" ON "support_messages"("conversation_id", "id");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

