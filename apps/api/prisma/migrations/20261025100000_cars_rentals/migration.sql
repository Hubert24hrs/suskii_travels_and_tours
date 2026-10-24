-- Cars P5: rental delivery, self-drive licences, handover photos and immutable handovers (ADR-050, ADR-051).

-- AlterEnum
ALTER TYPE "RefundReason" ADD VALUE 'deposit_release';

-- AlterTable
ALTER TABLE "rental_reservations" ADD COLUMN     "chauffeur_driver_id" UUID,
ADD COLUMN     "deposit_deduction_reason" TEXT,
ADD COLUMN     "licence_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "rental_vehicles" ADD COLUMN     "delivery_max_km" INTEGER,
ADD COLUMN     "delivery_per_km_minor" BIGINT,
ADD COLUMN     "excess_km_minor" BIGINT,
ADD COLUMN     "fuel_policy" TEXT NOT NULL DEFAULT 'full_to_full',
ADD COLUMN     "insurance_summary" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mileage_km_per_day" INTEGER,
ADD COLUMN     "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "rental_licences" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "number_encrypted" TEXT NOT NULL,
    "expires_on" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_upload',
    "storage_key" TEXT,
    "wrapped_key" TEXT NOT NULL DEFAULT '',
    "sha256" TEXT,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_handover_photos" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "handover_id" UUID,
    "storage_key" TEXT,
    "wrapped_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_handover_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_licences_reservation_id_key" ON "rental_licences"("reservation_id");

-- CreateIndex
CREATE INDEX "rental_licences_status_idx" ON "rental_licences"("status");

-- CreateIndex
CREATE INDEX "rental_handover_photos_reservation_id_idx" ON "rental_handover_photos"("reservation_id");

-- CreateIndex
CREATE INDEX "rental_handover_photos_handover_id_idx" ON "rental_handover_photos"("handover_id");

-- AddForeignKey
ALTER TABLE "rental_reservations" ADD CONSTRAINT "rental_reservations_chauffeur_driver_id_fkey" FOREIGN KEY ("chauffeur_driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_licences" ADD CONSTRAINT "rental_licences_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "rental_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_handover_photos" ADD CONSTRAINT "rental_handover_photos_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "rental_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_handover_photos" ADD CONSTRAINT "rental_handover_photos_handover_id_fkey" FOREIGN KEY ("handover_id") REFERENCES "rental_handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Values the API also validates; the database is the last line.
ALTER TABLE "rental_vehicles" ADD CONSTRAINT "rental_vehicles_policies_valid" CHECK (
  "fuel_policy" IN ('full_to_full', 'same_to_same')
  AND ("delivery_per_km_minor" IS NULL OR ("delivery_per_km_minor" > 0 AND "delivery_max_km" > 0))
  AND ("mileage_km_per_day" IS NULL OR ("mileage_km_per_day" > 0 AND "excess_km_minor" >= 0))
);
ALTER TABLE "rental_licences" ADD CONSTRAINT "rental_licences_status_valid" CHECK (
  "status" IN ('pending_upload', 'pending_scan', 'pending_review', 'approved', 'rejected')
);

-- Handover records are evidence (ADR-051): once written they cannot change. The only update
-- allowed clears the free-text damage notes when a closed booking is anonymised.
CREATE FUNCTION "rental_handovers_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."reservation_id", NEW."kind", NEW."odometer_km", NEW."fuel_eighths", NEW."recorded_by_id", NEW."created_at")
       IS NOT DISTINCT FROM
     ROW(OLD."id", OLD."reservation_id", OLD."kind", OLD."odometer_km", OLD."fuel_eighths", OLD."recorded_by_id", OLD."created_at")
     AND NEW."damage_notes" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rental handovers are immutable' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER "rental_handovers_immutable" BEFORE UPDATE ON "rental_handovers"
  FOR EACH ROW EXECUTE FUNCTION "rental_handovers_immutable"();

-- A photo is attached to its handover once; afterwards only its key and file can be destroyed
-- (account deletion, retention). Nothing else about it changes.
CREATE FUNCTION "rental_handover_photos_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id", NEW."reservation_id", NEW."sha256", NEW."content_type", NEW."size_bytes", NEW."uploaded_by_id", NEW."created_at")
       IS DISTINCT FROM
     ROW(OLD."id", OLD."reservation_id", OLD."sha256", OLD."content_type", OLD."size_bytes", OLD."uploaded_by_id", OLD."created_at") THEN
    RAISE EXCEPTION 'rental handover photos are immutable' USING ERRCODE = 'check_violation';
  END IF;
  -- Attaching a loose photo to a handover.
  IF OLD."handover_id" IS NULL AND NEW."handover_id" IS NOT NULL
     AND NEW."storage_key" IS NOT DISTINCT FROM OLD."storage_key"
     AND NEW."wrapped_key" = OLD."wrapped_key" AND NEW."deleted_at" IS NOT DISTINCT FROM OLD."deleted_at" THEN
    RETURN NEW;
  END IF;
  -- Destroying the file and its key.
  IF NEW."handover_id" IS NOT DISTINCT FROM OLD."handover_id"
     AND NEW."storage_key" IS NULL AND NEW."wrapped_key" = '' AND NEW."deleted_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'rental handover photos are immutable' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER "rental_handover_photos_immutable" BEFORE UPDATE ON "rental_handover_photos"
  FOR EACH ROW EXECUTE FUNCTION "rental_handover_photos_immutable"();
