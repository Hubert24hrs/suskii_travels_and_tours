-- Payment risk review (phase 11, ADR-040): signals on payments, the review queue and its refund reason.
-- CreateEnum
CREATE TYPE "PaymentRiskStatus" AS ENUM ('open', 'approved', 'rejected');

-- AlterEnum
ALTER TYPE "RefundReason" ADD VALUE 'risk_rejected';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "card_country" CHAR(2),
ADD COLUMN     "card_fingerprint_hash" TEXT,
ADD COLUMN     "ip_country" CHAR(2),
ADD COLUMN     "ip_hash" TEXT;

-- CreateTable
CREATE TABLE "payment_risk_reviews" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "signals" TEXT[],
    "status" "PaymentRiskStatus" NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_risk_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_risk_reviews_status_created_at_idx" ON "payment_risk_reviews"("status", "created_at");

-- CreateIndex
CREATE INDEX "payment_risk_reviews_booking_id_idx" ON "payment_risk_reviews"("booking_id");

-- CreateIndex
CREATE INDEX "payments_ip_hash_created_at_idx" ON "payments"("ip_hash", "created_at");

-- AddForeignKey
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_risk_reviews" ADD CONSTRAINT "payment_risk_reviews_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

