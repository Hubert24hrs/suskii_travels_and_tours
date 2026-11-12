-- CreateIndex
CREATE INDEX "bookings_created_at_idx" ON "bookings"("created_at");

-- CreateIndex
CREATE INDEX "ledger_transactions_kind_created_at_idx" ON "ledger_transactions"("kind", "created_at");

