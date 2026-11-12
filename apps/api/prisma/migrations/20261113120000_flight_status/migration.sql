-- Live flight status on the day of travel (ADR-095). A new table and a nullable column the
-- revision still serving does not read, so the change is expand-only.

-- When a ticketed flight's status is next read; null when it is not followed.
ALTER TABLE "booking_items" ADD COLUMN "next_status_check_at" TIMESTAMPTZ(3);

CREATE INDEX "booking_items_next_status_check_at_idx" ON "booking_items"("next_status_check_at");

-- The last reading of each flight of a booking, and what the traveller was last told.
CREATE TABLE "flight_statuses" (
    "id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "flight" INTEGER NOT NULL,
    "carrier_code" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "scheduled_departure" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_arrival" TIMESTAMPTZ(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "estimated_departure" TIMESTAMPTZ(3),
    "estimated_arrival" TIMESTAMPTZ(3),
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "departure_terminal" TEXT,
    "departure_gate" TEXT,
    "arrival_terminal" TEXT,
    "arrival_gate" TEXT,
    "baggage_belt" TEXT,
    "checked_at" TIMESTAMPTZ(3) NOT NULL,
    "alerted_delay_minutes" INTEGER,
    "alerted_state" TEXT,
    "alerted_at" TIMESTAMPTZ(3),

    CONSTRAINT "flight_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "flight_statuses_booking_item_id_flight_key" ON "flight_statuses"("booking_item_id", "flight");

ALTER TABLE "flight_statuses" ADD CONSTRAINT "flight_statuses_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
