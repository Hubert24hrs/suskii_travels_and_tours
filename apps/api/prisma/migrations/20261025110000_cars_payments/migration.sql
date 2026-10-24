-- Cars P6 (ADR-051): ledger reconciliation and batched driver payouts.

-- Where the ledger, our payment records and the provider disagree; finance resolves them.
CREATE TYPE "DiscrepancyKind" AS ENUM ('ledger_missing', 'ledger_amount', 'provider_status', 'provider_amount', 'orphan_ledger');
CREATE TYPE "DiscrepancySubject" AS ENUM ('payment', 'refund', 'payout');
CREATE TYPE "DiscrepancyStatus" AS ENUM ('open', 'resolved');
CREATE TYPE "DiscrepancyResolution" AS ENUM ('corrected', 'accepted');

CREATE TABLE "reconciliation_discrepancies" (
    "id" UUID NOT NULL,
    "kind" "DiscrepancyKind" NOT NULL,
    "subject_type" "DiscrepancySubject" NOT NULL,
    "subject_id" UUID NOT NULL,
    "booking_id" UUID,
    "currency" CHAR(3),
    "expected_minor" BIGINT,
    "actual_minor" BIGINT,
    "status" "DiscrepancyStatus" NOT NULL DEFAULT 'open',
    "resolution" "DiscrepancyResolution",
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id"),
    -- Open means unresolved; a resolution always names who and when.
    CONSTRAINT "reconciliation_discrepancies_resolution_valid" CHECK (
      ("status" = 'open' AND "resolution" IS NULL AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL)
      OR ("status" = 'resolved' AND "resolution" IS NOT NULL AND "resolved_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "reconciliation_discrepancies_subject_id_kind_key" ON "reconciliation_discrepancies"("subject_type", "subject_id", "kind");
CREATE INDEX "reconciliation_discrepancies_status_detected_at_idx" ON "reconciliation_discrepancies"("status", "detected_at");

-- When the reconciliation sweep last compared a record with the ledger (and the provider).
ALTER TABLE "payments" ADD COLUMN "ledger_checked_at" TIMESTAMPTZ(3);
ALTER TABLE "refunds" ADD COLUMN "ledger_checked_at" TIMESTAMPTZ(3);
CREATE INDEX "payments_status_ledger_checked_at_idx" ON "payments"("status", "ledger_checked_at");
CREATE INDEX "refunds_status_ledger_checked_at_idx" ON "refunds"("status", "ledger_checked_at");

-- Payouts go out in batches; a failed one waits for new bank details before the next try.
ALTER TABLE "driver_payouts" ADD COLUMN "batch_id" UUID,
ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ledger_checked_at" TIMESTAMPTZ(3);
ALTER TABLE "drivers" ADD COLUMN "payout_account_updated_at" TIMESTAMPTZ(3);
UPDATE "drivers" SET "payout_account_updated_at" = "updated_at" WHERE "payout_account_encrypted" IS NOT NULL;

CREATE INDEX "driver_payouts_batch_id_idx" ON "driver_payouts"("batch_id");
CREATE INDEX "driver_payouts_status_ledger_checked_at_idx" ON "driver_payouts"("status", "ledger_checked_at");
-- At most one payout in flight per driver and currency: a second batch cannot pay twice.
CREATE UNIQUE INDEX "driver_payouts_one_pending" ON "driver_payouts" ("driver_id", "currency") WHERE "status" = 'pending';
