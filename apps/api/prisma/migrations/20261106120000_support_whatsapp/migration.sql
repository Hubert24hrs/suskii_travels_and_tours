-- WhatsApp as a support channel (ADR-084): contacts with sealed numbers and business-scoped
-- user ids, the contact on WhatsApp conversations, and per-message kind, WhatsApp message id,
-- delivery state and template notice. Expand-only: a new table, nullable columns and a column
-- with a default.
-- CreateEnum
CREATE TYPE "SupportMessageKind" AS ENUM ('text', 'unsupported');

-- CreateEnum
CREATE TYPE "SupportDeliveryStatus" AS ENUM ('pending', 'sent', 'delivered', 'read', 'failed');

-- AlterTable
ALTER TABLE "support_conversations" ADD COLUMN     "whatsapp_contact_id" UUID;

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "delivery_error" VARCHAR(64),
ADD COLUMN     "delivery_status" "SupportDeliveryStatus",
ADD COLUMN     "external_id" VARCHAR(255),
ADD COLUMN     "kind" "SupportMessageKind" NOT NULL DEFAULT 'text',
ADD COLUMN     "notice_sent_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "id" UUID NOT NULL,
    "phone_hash" TEXT,
    "phone_encrypted" TEXT,
    "bsuid_hash" TEXT,
    "bsuid_encrypted" TEXT,
    "last_inbound_at" TIMESTAMPTZ(3) NOT NULL,
    "opted_out_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_phone_hash_key" ON "whatsapp_contacts"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_bsuid_hash_key" ON "whatsapp_contacts"("bsuid_hash");

-- CreateIndex
CREATE INDEX "whatsapp_contacts_last_inbound_at_idx" ON "whatsapp_contacts"("last_inbound_at");

-- CreateIndex
CREATE INDEX "support_conversations_whatsapp_contact_id_updated_at_idx" ON "support_conversations"("whatsapp_contact_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_external_id_key" ON "support_messages"("external_id");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_whatsapp_contact_id_fkey" FOREIGN KEY ("whatsapp_contact_id") REFERENCES "whatsapp_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

