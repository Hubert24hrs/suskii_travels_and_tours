-- Retention (phase 11, ADR-039): when a closed booking's remaining personal data was cleared
-- after FINANCIAL_RECORDS_RETENTION_YEARS. Indexed for the daily sweep.
ALTER TABLE "bookings" ADD COLUMN "anonymised_at" TIMESTAMPTZ(3);
CREATE INDEX "bookings_status_updated_at_idx" ON "bookings"("status", "updated_at");
