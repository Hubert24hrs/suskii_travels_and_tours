-- Ads with consent (ADR-079). Expand only: a new enum and table, nothing existing changes.

-- CreateEnum
CREATE TYPE "AdConversionStatus" AS ENUM ('waiting', 'sent', 'failed', 'withdrawn');

-- CreateTable
CREATE TABLE "ad_conversions" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "click_ids" JSONB,
    "status" "AdConversionStatus" NOT NULL DEFAULT 'waiting',
    "sent_to" VARCHAR(16)[] DEFAULT ARRAY[]::VARCHAR(16)[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ad_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ad_conversions_booking_id_key" ON "ad_conversions"("booking_id");

-- CreateIndex
CREATE INDEX "ad_conversions_status_next_attempt_at_idx" ON "ad_conversions"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "ad_conversions_created_at_idx" ON "ad_conversions"("created_at");

-- AddForeignKey
ALTER TABLE "ad_conversions" ADD CONSTRAINT "ad_conversions_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

