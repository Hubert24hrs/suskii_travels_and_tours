-- Tax rules per selling country (ADR-072). Expand only: a new enum and a new table that the
-- revision still serving never reads.

-- CreateEnum
CREATE TYPE "TaxBasis" AS ENUM ('margin', 'full');

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "basis" "TaxBasis" NOT NULL,
    "vertical" "Vertical",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registration_number" TEXT,
    "valid_from" TIMESTAMPTZ(3),
    "valid_to" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_rules_country_active_idx" ON "tax_rules"("country", "active");

-- A rate is a share of the taxable amount (0 to 100%), and the country is an upper-case code.
ALTER TABLE "tax_rules"
    ADD CONSTRAINT "tax_rules_rate_bps_range" CHECK ("rate_bps" >= 0 AND "rate_bps" <= 10000),
    ADD CONSTRAINT "tax_rules_country_format" CHECK ("country" ~ '^[A-Z]{2}$');
