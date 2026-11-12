-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('DRAFT', 'PRICED', 'HELD', 'AWAITING_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'TICKETING', 'CONFIRMED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BookingItemType" AS ENUM ('flight', 'hotel');

-- CreateEnum
CREATE TYPE "PassengerType" AS ENUM ('adult', 'child', 'infant');

-- CreateEnum
CREATE TYPE "BookingActorType" AS ENUM ('customer', 'system', 'webhook', 'staff');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "BookingDocumentType" AS ENUM ('e_ticket', 'hotel_voucher');

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'DRAFT',
    "vertical" "Vertical" NOT NULL,
    "user_id" UUID,
    "access_token_hash" TEXT,
    "contact_encrypted" TEXT NOT NULL,
    "contact_email_hash" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "price" JSONB NOT NULL,
    "pending_price" JSONB,
    "promo_code_id" UUID,
    "channel" "SalesChannel" NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-NG',
    "terms_version" TEXT NOT NULL,
    "terms_accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "payment_deadline" TIMESTAMPTZ(3),
    "ticketing_attempts" INTEGER NOT NULL DEFAULT 0,
    "next_ticketing_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_items" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "BookingItemType" NOT NULL,
    "offer_id" UUID NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplier_offer_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "services" JSONB NOT NULL DEFAULT '[]',
    "total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "supplier_reference" TEXT,
    "ticket_numbers" JSONB,
    "booked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_passengers" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "PassengerType" NOT NULL,
    "title" TEXT,
    "gender" TEXT,
    "given_names" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "date_of_birth" DATE,
    "nationality" CHAR(2),
    "passport_encrypted" TEXT,
    "document_hint" TEXT,
    "issuing_country" CHAR(2),
    "document_expiry" DATE,
    "traveller_id" UUID,
    "room_index" INTEGER,

    CONSTRAINT "booking_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "from_status" "BookingStatus",
    "to_status" "BookingStatus" NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "actor_type" "BookingActorType" NOT NULL,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travellers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "given_names" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "nationality" CHAR(2) NOT NULL,
    "passport_encrypted" TEXT,
    "document_hint" TEXT,
    "issuing_country" CHAR(2),
    "document_expiry" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "travellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "checkout_url" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "succeeded_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "requires_refund" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider_reference" TEXT,
    "payload" JSONB NOT NULL,
    "outcome" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_documents" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "type" "BookingDocumentType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_reference_key" ON "bookings"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_access_token_hash_key" ON "bookings"("access_token_hash");

-- CreateIndex
CREATE INDEX "bookings_user_id_created_at_idx" ON "bookings"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "bookings_status_payment_deadline_idx" ON "bookings"("status", "payment_deadline");

-- CreateIndex
CREATE INDEX "bookings_status_next_ticketing_at_idx" ON "bookings"("status", "next_ticketing_at");

-- CreateIndex
CREATE INDEX "bookings_contact_email_hash_idx" ON "bookings"("contact_email_hash");

-- CreateIndex
CREATE INDEX "booking_items_booking_id_idx" ON "booking_items"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_passengers_booking_id_position_key" ON "booking_passengers"("booking_id", "position");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_occurred_at_idx" ON "booking_status_history"("booking_id", "occurred_at");

-- CreateIndex
CREATE INDEX "travellers_user_id_idx" ON "travellers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_reference_key" ON "payments"("provider_reference");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_documents_booking_id_type_key" ON "booking_documents"("booking_id", "type");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_passengers" ADD CONSTRAINT "booking_passengers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travellers" ADD CONSTRAINT "travellers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_documents" ADD CONSTRAINT "booking_documents_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Booking status history is append-only, like the audit log: rows can be added, never changed or
-- deleted (bookings are never deleted either; the cascade exists for test resets via TRUNCATE).
CREATE FUNCTION booking_status_history_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'booking_status_history is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER booking_status_history_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "booking_status_history"
  FOR EACH ROW EXECUTE FUNCTION booking_status_history_reject_mutation();
