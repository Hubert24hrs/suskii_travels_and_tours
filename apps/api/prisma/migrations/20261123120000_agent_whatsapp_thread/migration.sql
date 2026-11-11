-- The assistant over WhatsApp (ADR-084, ADR-101): an assistant conversation can name the
-- WhatsApp support conversation it answers in. A new nullable column, its unique index and its
-- foreign key; nothing existing changes.
-- AlterTable
ALTER TABLE "agent_conversations" ADD COLUMN "support_conversation_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "agent_conversations_support_conversation_id_key" ON "agent_conversations"("support_conversation_id");

-- AddForeignKey
ALTER TABLE "agent_conversations" ADD CONSTRAINT "agent_conversations_support_conversation_id_fkey" FOREIGN KEY ("support_conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
