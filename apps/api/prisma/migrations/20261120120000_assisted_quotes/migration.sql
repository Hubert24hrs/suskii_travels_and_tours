-- Assisted quotes (ADR-104): a request to have a price confirmed by a person, and the offer staff
-- make from it. Expand-only: two new types, one new value in each of two existing types and one new table;
-- the revision still serving sells no item of the new vertical and reads none of this.

-- CreateEnum
CREATE TYPE "AssistedQuoteProduct" AS ENUM ('flight', 'hotel', 'car', 'transfer', 'tour', 'package', 'other');

-- CreateEnum
CREATE TYPE "AssistedQuoteStatus" AS ENUM ('requested', 'offered', 'unavailable', 'expired', 'withdrawn', 'booked');

-- AlterEnum
ALTER TYPE "BookingItemType" ADD VALUE 'assisted';

-- AlterEnum
ALTER TYPE "Vertical" ADD VALUE 'assisted';

-- CreateTable
CREATE TABLE "assisted_quotes" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(12) NOT NULL,
    "user_id" UUID NOT NULL,
    "product" "AssistedQuoteProduct" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "request" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "observation_id" UUID,
    "reference_minor" BIGINT,
    "reference_currency" CHAR(3),
    "reference_source" VARCHAR(120),
    "reference_seen_at" TIMESTAMPTZ(3),
    "status" "AssistedQuoteStatus" NOT NULL DEFAULT 'requested',
    "closed_reason" VARCHAR(40),
    "supplier_name" VARCHAR(120),
    "supplier_minor" BIGINT,
    "supplier_currency" CHAR(3),
    "evidence_url" VARCHAR(500),
    "details" JSONB,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(3),
    "offer_id" UUID,
    "offer_expires_at" TIMESTAMPTZ(3),
    "booking_evidence_url" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assisted_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assisted_quotes_reference_key" ON "assisted_quotes"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "assisted_quotes_offer_id_key" ON "assisted_quotes"("offer_id");

-- CreateIndex
CREATE INDEX "assisted_quotes_status_created_at_idx" ON "assisted_quotes"("status", "created_at");

-- CreateIndex
CREATE INDEX "assisted_quotes_user_id_created_at_idx" ON "assisted_quotes"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "assisted_quotes" ADD CONSTRAINT "assisted_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

