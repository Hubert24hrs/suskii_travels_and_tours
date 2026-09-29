-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('flights', 'hotels', 'packages', 'tours', 'visa', 'travel_addons');

-- CreateEnum
CREATE TYPE "CabinClass" AS ENUM ('economy', 'premium_economy', 'business', 'first');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('web', 'mobile');

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('guest', 'member', 'prime');

-- CreateEnum
CREATE TYPE "AdjustmentType" AS ENUM ('percentage', 'fixed');

-- CreateEnum
CREATE TYPE "FeeBasis" AS ENUM ('per_booking', 'per_passenger');

-- AlterTable
ALTER TABLE "airports" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "cities" ADD COLUMN     "search_text" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "markup_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "channel" "SalesChannel",
    "user_tier" "UserTier",
    "supplier" TEXT,
    "origin_code" VARCHAR(3),
    "destination_code" VARCHAR(3),
    "origin_country" CHAR(2),
    "destination_country" CHAR(2),
    "carrier_code" VARCHAR(3),
    "cabin_class" "CabinClass",
    "type" "AdjustmentType" NOT NULL,
    "value" BIGINT NOT NULL,
    "currency" CHAR(3),
    "min_amount_minor" BIGINT,
    "max_amount_minor" BIGINT,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "markup_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "channel" "SalesChannel",
    "user_tier" "UserTier",
    "type" "AdjustmentType" NOT NULL,
    "value" BIGINT NOT NULL,
    "currency" CHAR(3),
    "basis" "FeeBasis" NOT NULL DEFAULT 'per_booking',
    "min_amount_minor" BIGINT,
    "max_amount_minor" BIGINT,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" "AdjustmentType" NOT NULL,
    "value" BIGINT NOT NULL,
    "currency" CHAR(3),
    "max_discount_minor" BIGINT,
    "min_spend_minor" BIGINT,
    "verticals" "Vertical"[],
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "max_redemptions" INTEGER,
    "max_redemptions_per_user" INTEGER,
    "requires_account" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_redemptions" (
    "id" UUID NOT NULL,
    "promo_code_id" UUID NOT NULL,
    "user_id" UUID,
    "booking_id" UUID,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplier_offer_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "supplier_total_minor" BIGINT NOT NULL,
    "supplier_currency" CHAR(3) NOT NULL,
    "price" JSONB NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "search_id" TEXT,
    "user_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_logs" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vertical" "Vertical" NOT NULL,
    "origin" VARCHAR(3),
    "destination" VARCHAR(64),
    "departure_date" DATE,
    "return_date" DATE,
    "slice_count" INTEGER,
    "travellers" INTEGER NOT NULL,
    "cabin_class" "CabinClass",
    "channel" "SalesChannel",
    "cache_hit" BOOLEAN NOT NULL,
    "partial" BOOLEAN NOT NULL,
    "result_count" INTEGER NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "supplier_outcomes" JSONB NOT NULL,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "markup_rules_vertical_active_priority_idx" ON "markup_rules"("vertical", "active", "priority");

-- CreateIndex
CREATE INDEX "fee_rules_vertical_active_idx" ON "fee_rules"("vertical", "active");

-- CreateIndex
CREATE UNIQUE INDEX "promo_codes_code_key" ON "promo_codes"("code");

-- CreateIndex
CREATE INDEX "promo_redemptions_promo_code_id_user_id_idx" ON "promo_redemptions"("promo_code_id", "user_id");

-- CreateIndex
CREATE INDEX "offers_supplier_supplier_offer_id_idx" ON "offers"("supplier", "supplier_offer_id");

-- CreateIndex
CREATE INDEX "offers_expires_at_idx" ON "offers"("expires_at");

-- CreateIndex
CREATE INDEX "search_logs_vertical_occurred_at_idx" ON "search_logs"("vertical", "occurred_at");

-- CreateIndex
CREATE INDEX "search_logs_origin_destination_idx" ON "search_logs"("origin", "destination");

-- CreateIndex
CREATE INDEX "airports_search_text_trgm_idx" ON "airports" USING GIN ("search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "cities_search_text_trgm_idx" ON "cities" USING GIN ("search_text" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
