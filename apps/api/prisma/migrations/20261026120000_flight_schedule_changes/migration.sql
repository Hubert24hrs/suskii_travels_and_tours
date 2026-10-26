-- Airline schedule changes on ticketed flights (ADR-065). Expand only: a new table, a new
-- nullable column and indexes; the revision still serving ignores all of them.

CREATE TYPE "ScheduleChangeStatus" AS ENUM ('open', 'accepted', 'cancelled', 'changed');

-- When a ticketed flight is next asked for airline changes; null once it has departed or its
-- supplier does not report changes.
ALTER TABLE "booking_items" ADD COLUMN "next_change_check_at" TIMESTAMPTZ(3);
CREATE INDEX "booking_items_next_change_check_at_idx" ON "booking_items"("next_change_check_at");

-- Flights ticketed before this release are checked on the first sweep; the sweep stops checking
-- those that have departed or whose supplier does not report changes.
UPDATE "booking_items"
SET "next_change_check_at" = CURRENT_TIMESTAMP
WHERE "type" = 'flight' AND "supplier_order_id" IS NOT NULL AND "booked_at" IS NOT NULL;

-- One row per change the airline made: the changed slices before and after, and how it ended.
CREATE TABLE "flight_schedule_changes" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplier_change_id" TEXT NOT NULL,
    "removed" JSONB NOT NULL,
    "added" JSONB NOT NULL,
    "acceptable" BOOLEAN NOT NULL,
    "status" "ScheduleChangeStatus" NOT NULL DEFAULT 'open',
    "changed_at" TIMESTAMPTZ(3) NOT NULL,
    "detected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "flight_schedule_changes_pkey" PRIMARY KEY ("id"),
    -- Open means unresolved; a resolution always says when.
    CONSTRAINT "flight_schedule_changes_resolution_valid" CHECK (
      ("status" = 'open' AND "resolved_at" IS NULL)
      OR ("status" <> 'open' AND "resolved_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "flight_schedule_changes_supplier_supplier_change_id_key" ON "flight_schedule_changes"("supplier", "supplier_change_id");
CREATE INDEX "flight_schedule_changes_booking_id_detected_at_idx" ON "flight_schedule_changes"("booking_id", "detected_at");
CREATE INDEX "flight_schedule_changes_booking_item_id_idx" ON "flight_schedule_changes"("booking_item_id");

ALTER TABLE "flight_schedule_changes" ADD CONSTRAINT "flight_schedule_changes_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "flight_schedule_changes" ADD CONSTRAINT "flight_schedule_changes_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
