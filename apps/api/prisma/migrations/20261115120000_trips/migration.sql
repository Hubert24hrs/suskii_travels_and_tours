-- Combined trips (ADR-099): several bookings put together by a traveller and paid with one
-- checkout. Expand-only: two new tables, and nullable columns on bookings and payments that the
-- revision still serving does not read.

-- The ledger reconciliation names a trip checkout as the subject of a finding. Only the new
-- revision writes the value.
ALTER TYPE "DiscrepancySubject" ADD VALUE 'trip_payment';

CREATE TABLE "trips" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "user_id" UUID,
    "plan" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trips_reference_key" ON "trips"("reference");
CREATE INDEX "trips_user_id_created_at_idx" ON "trips"("user_id", "created_at");

ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One hosted checkout for every unpaid booking of a trip.
CREATE TABLE "trip_payments" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "provider_transaction_id" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "received_minor" BIGINT,
    "received_currency" CHAR(3),
    "checkout_url" TEXT NOT NULL,
    "method" TEXT,
    "channel" "SalesChannel" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "succeeded_at" TIMESTAMPTZ(3),
    "failure_reason" TEXT,
    "reconciled_at" TIMESTAMPTZ(3),
    "ledger_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trip_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "trip_payments_amount_minor_check" CHECK ("amount_minor" > 0)
);

CREATE UNIQUE INDEX "trip_payments_provider_reference_key" ON "trip_payments"("provider_reference");
CREATE INDEX "trip_payments_trip_id_created_at_idx" ON "trip_payments"("trip_id", "created_at");
CREATE INDEX "trip_payments_status_expires_at_idx" ON "trip_payments"("status", "expires_at");
CREATE INDEX "trip_payments_status_ledger_checked_at_idx" ON "trip_payments"("status", "ledger_checked_at");

ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_trip_id_fkey"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A rental car's country: the fleet was Nigerian only, and a trip abroad can now take a car at
-- its destination. Existing cars keep the default.
ALTER TABLE "rental_vehicles" ADD COLUMN "country_code" CHAR(2) NOT NULL DEFAULT 'NG';

-- A booking's place in a trip, and a payment's share of a trip checkout.
ALTER TABLE "bookings"
  ADD COLUMN "trip_id" UUID,
  ADD COLUMN "trip_component" TEXT;

CREATE INDEX "bookings_trip_id_idx" ON "bookings"("trip_id");

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_trip_id_fkey"
  FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A trip has each part at most once.
CREATE UNIQUE INDEX "bookings_trip_id_trip_component_key"
  ON "bookings"("trip_id", "trip_component") WHERE "trip_id" IS NOT NULL;

ALTER TABLE "payments" ADD COLUMN "trip_payment_id" UUID;

CREATE INDEX "payments_trip_payment_id_idx" ON "payments"("trip_payment_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_trip_payment_id_fkey"
  FOREIGN KEY ("trip_payment_id") REFERENCES "trip_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
