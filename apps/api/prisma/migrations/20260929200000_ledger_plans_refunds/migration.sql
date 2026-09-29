-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('checkout', 'wallet');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'income', 'expense');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "PaymentPlanKind" AS ENUM ('hold', 'installments');

-- CreateEnum
CREATE TYPE "PaymentPlanStatus" AS ENUM ('active', 'completed', 'defaulted', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "InstallmentStatus" AS ENUM ('pending', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending_approval', 'approved', 'processing', 'succeeded', 'failed', 'rejected', 'needs_review');

-- CreateEnum
CREATE TYPE "RefundDestination" AS ENUM ('original', 'wallet');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('duplicate_payment', 'amount_mismatch', 'late_payment', 'ticketing_failed', 'installment_default', 'customer_cancellation', 'goodwill', 'supplier_cancellation', 'other');

-- AlterTable
ALTER TABLE "booking_items" ADD COLUMN     "held_until" TIMESTAMPTZ(3),
ADD COLUMN     "price_guaranteed_until" TIMESTAMPTZ(3),
ADD COLUMN     "supplier_order_id" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "installment_id" UUID,
ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'checkout',
ADD COLUMN     "method" TEXT,
ADD COLUMN     "provider_transaction_id" TEXT,
ADD COLUMN     "reconciled_at" TIMESTAMPTZ(3),
ALTER COLUMN "checkout_url" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "allow_negative" BOOLEAN NOT NULL DEFAULT false,
    "balance_minor" BIGINT NOT NULL DEFAULT 0,
    "user_id" UUID,
    "booking_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "booking_id" UUID,
    "payment_id" UUID,
    "refund_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_plans" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" "PaymentPlanKind" NOT NULL,
    "status" "PaymentPlanStatus" NOT NULL DEFAULT 'active',
    "currency" CHAR(3) NOT NULL,
    "total_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "grace_hours" INTEGER NOT NULL,
    "default_fee_bps" INTEGER NOT NULL,
    "deadline" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installments" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(3),
    "reminder_3d_sent_at" TIMESTAMPTZ(3),
    "reminder_1d_sent_at" TIMESTAMPTZ(3),

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "destination" "RefundDestination" NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "cancels_booking" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "requested_by_user_id" UUID,
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "provider_refund_id" TEXT,
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMPTZ(3),
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_access_links" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_access_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_key" ON "ledger_accounts"("code");

-- CreateIndex
CREATE INDEX "ledger_accounts_user_id_idx" ON "ledger_accounts"("user_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_booking_id_idx" ON "ledger_accounts"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_booking_id_idx" ON "ledger_transactions"("booking_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_payment_id_idx" ON "ledger_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_plans_booking_id_key" ON "payment_plans"("booking_id");

-- CreateIndex
CREATE INDEX "payment_plans_status_deadline_idx" ON "payment_plans"("status", "deadline");

-- CreateIndex
CREATE INDEX "installments_status_due_at_idx" ON "installments"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "installments_plan_id_sequence_key" ON "installments"("plan_id", "sequence");

-- CreateIndex
CREATE INDEX "refunds_status_updated_at_idx" ON "refunds"("status", "updated_at");

-- CreateIndex
CREATE INDEX "refunds_booking_id_idx" ON "refunds"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_provider_provider_refund_id_key" ON "refunds"("provider", "provider_refund_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_access_links_token_hash_key" ON "booking_access_links"("token_hash");

-- CreateIndex
CREATE INDEX "booking_access_links_booking_id_idx" ON "booking_access_links"("booking_id");

-- CreateIndex
CREATE INDEX "payments_status_expires_at_idx" ON "payments"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_installment_id_fkey" FOREIGN KEY ("installment_id") REFERENCES "installments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "payment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_access_links" ADD CONSTRAINT "booking_access_links_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Ledger invariants (ADR-017), enforced by the database so no code path can break them.
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_non_negative" CHECK ("allow_negative" OR "balance_minor" >= 0);
ALTER TABLE "payment_plans" ADD CONSTRAINT "payment_plans_amounts_valid" CHECK ("total_minor" > 0 AND "fee_minor" >= 0 AND "default_fee_bps" BETWEEN 0 AND 10000 AND "grace_hours" >= 0);
ALTER TABLE "installments" ADD CONSTRAINT "installments_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_source_valid" CHECK ("source" IN ('booking', 'unapplied', 'wallet'));

-- Entries and transactions are append-only: corrections are new, reversing transactions.
CREATE FUNCTION ledger_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% blocked)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER ledger_entries_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();

CREATE TRIGGER ledger_transactions_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_mutation();

-- Each entry updates its account's cached balance in the account's normal direction (debit for
-- assets and expenses, credit for liabilities and income). The row lock serialises concurrent
-- postings to one account, and the non-negative check rejects an overdraft atomically.
CREATE FUNCTION ledger_apply_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  account_type "LedgerAccountType";
  account_currency CHAR(3);
  delta BIGINT;
BEGIN
  SELECT "type", "currency" INTO account_type, account_currency
    FROM "ledger_accounts" WHERE "id" = NEW."account_id" FOR UPDATE;
  IF account_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'ledger entry currency % does not match its account (%)', NEW."currency", account_currency
      USING ERRCODE = 'check_violation';
  END IF;
  IF (account_type IN ('asset', 'expense')) = (NEW."direction" = 'debit') THEN
    delta := NEW."amount_minor";
  ELSE
    delta := -NEW."amount_minor";
  END IF;
  UPDATE "ledger_accounts"
     SET "balance_minor" = "balance_minor" + delta, "updated_at" = CURRENT_TIMESTAMP
   WHERE "id" = NEW."account_id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_apply
  BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_apply_entry();

-- At commit, every transaction must balance per currency (and have entries on both sides).
CREATE FUNCTION ledger_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unbalanced CHAR(3);
BEGIN
  SELECT "currency" INTO unbalanced
    FROM "ledger_entries"
   WHERE "transaction_id" = NEW."transaction_id"
   GROUP BY "currency"
  HAVING SUM(CASE WHEN "direction" = 'debit' THEN "amount_minor" ELSE -"amount_minor" END) <> 0
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'ledger transaction % does not balance in %', NEW."transaction_id", unbalanced
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
