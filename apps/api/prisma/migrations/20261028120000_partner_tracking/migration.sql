-- Affiliate partner tracking (ADR-070). Expand only: new enums and two new tables; the revision
-- still serving never reads them.

-- CreateEnum
CREATE TYPE "PartnerCategory" AS ENUM ('car_rental', 'transfer', 'activity', 'esim', 'insurance');

-- CreateEnum
CREATE TYPE "AffiliateNetwork" AS ENUM ('mock', 'travelpayouts', 'viator');

-- CreateEnum
CREATE TYPE "PartnerConversionStatus" AS ENUM ('pending', 'confirmed', 'cancelled');

-- CreateTable
CREATE TABLE "partner_clicks" (
    "id" UUID NOT NULL,
    "program_id" VARCHAR(40) NOT NULL,
    "category" "PartnerCategory" NOT NULL,
    "network" "AffiliateNetwork" NOT NULL,
    "user_id" UUID,
    "booking_id" UUID,
    "channel" "SalesChannel",
    "campaign" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_conversions" (
    "id" UUID NOT NULL,
    "network" "AffiliateNetwork" NOT NULL,
    "external_id" VARCHAR(128) NOT NULL,
    "click_id" UUID,
    "program_id" VARCHAR(40),
    "status" "PartnerConversionStatus" NOT NULL,
    "price_minor" BIGINT,
    "price_currency" CHAR(3),
    "commission_minor" BIGINT,
    "commission_currency" CHAR(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partner_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partner_clicks_program_id_created_at_idx" ON "partner_clicks"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_clicks_user_id_idx" ON "partner_clicks"("user_id");

-- CreateIndex
CREATE INDEX "partner_clicks_created_at_idx" ON "partner_clicks"("created_at");

-- CreateIndex
CREATE INDEX "partner_conversions_program_id_created_at_idx" ON "partner_conversions"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "partner_conversions_click_id_idx" ON "partner_conversions"("click_id");

-- CreateIndex
CREATE UNIQUE INDEX "partner_conversions_network_external_id_key" ON "partner_conversions"("network", "external_id");

-- AddForeignKey
ALTER TABLE "partner_clicks" ADD CONSTRAINT "partner_clicks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_clicks" ADD CONSTRAINT "partner_clicks_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_conversions" ADD CONSTRAINT "partner_conversions_click_id_fkey" FOREIGN KEY ("click_id") REFERENCES "partner_clicks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

