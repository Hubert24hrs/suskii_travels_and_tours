-- Refund offer for airline changes (ADR-073). Expand only: both columns have defaults, so the
-- revision still serving keeps working.
ALTER TABLE "flight_schedule_changes"
  ADD COLUMN "significant" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "refund_offer_withdrawn_at" TIMESTAMPTZ(3);
