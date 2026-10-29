-- CreateEnum
CREATE TYPE "CompanyTopUpStatus" AS ENUM ('pending', 'succeeded', 'failed', 'expired', 'cancelled');

-- AlterEnum
ALTER TYPE "DiscrepancySubject" ADD VALUE 'company_topup';

-- AlterEnum
ALTER TYPE "PaymentKind" ADD VALUE 'company_wallet';

-- AlterEnum
ALTER TYPE "RefundDestination" ADD VALUE 'company_wallet';

-- CreateTable
CREATE TABLE "company_wallet_top_ups" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "requested_by_id" UUID,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "status" "CompanyTopUpStatus" NOT NULL DEFAULT 'pending',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "received_minor" BIGINT,
    "received_currency" CHAR(3),
    "checkout_url" TEXT NOT NULL,
    "method" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "succeeded_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "reconciled_at" TIMESTAMPTZ(3),
    "ledger_checked_at" TIMESTAMPTZ(3),
    "ip_hash" TEXT,
    "ip_country" CHAR(2),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_wallet_top_ups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_wallet_top_ups_reference_key" ON "company_wallet_top_ups"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "company_wallet_top_ups_provider_reference_key" ON "company_wallet_top_ups"("provider_reference");

-- CreateIndex
CREATE INDEX "company_wallet_top_ups_company_id_created_at_idx" ON "company_wallet_top_ups"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "company_wallet_top_ups_status_expires_at_idx" ON "company_wallet_top_ups"("status", "expires_at");

-- CreateIndex
CREATE INDEX "company_wallet_top_ups_status_ledger_checked_at_idx" ON "company_wallet_top_ups"("status", "ledger_checked_at");

-- AddForeignKey
ALTER TABLE "company_wallet_top_ups" ADD CONSTRAINT "company_wallet_top_ups_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_wallet_top_ups" ADD CONSTRAINT "company_wallet_top_ups_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

