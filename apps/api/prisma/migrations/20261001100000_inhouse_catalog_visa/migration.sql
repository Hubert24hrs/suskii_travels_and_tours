-- CreateEnum
CREATE TYPE "SeatState" AS ENUM ('reserved', 'sold', 'released');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "DepartureStatus" AS ENUM ('open', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "AddonProductType" AS ENUM ('insurance', 'airport_transfer', 'esim', 'lounge');

-- CreateEnum
CREATE TYPE "AddonPricingBasis" AS ENUM ('per_person', 'per_booking', 'per_day', 'per_person_per_day');

-- CreateEnum
CREATE TYPE "VisaPurpose" AS ENUM ('tourism', 'business', 'study', 'transit');

-- CreateEnum
CREATE TYPE "VisaRequirement" AS ENUM ('visa_free', 'visa_on_arrival', 'e_visa', 'visa_required', 'not_available');

-- CreateEnum
CREATE TYPE "VisaApplicationStatus" AS ENUM ('awaiting_documents', 'submitted', 'in_review', 'action_required', 'lodged', 'approved', 'refused', 'withdrawn');

-- CreateEnum
CREATE TYPE "VisaDocumentStatus" AS ENUM ('pending_scan', 'clean', 'infected', 'scan_failed', 'rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingDocumentType" ADD VALUE 'package_voucher';
ALTER TYPE "BookingDocumentType" ADD VALUE 'tour_voucher';
ALTER TYPE "BookingDocumentType" ADD VALUE 'addon_voucher';
ALTER TYPE "BookingDocumentType" ADD VALUE 'visa_confirmation';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingItemType" ADD VALUE 'package';
ALTER TYPE "BookingItemType" ADD VALUE 'tour';
ALTER TYPE "BookingItemType" ADD VALUE 'visa';
ALTER TYPE "BookingItemType" ADD VALUE 'addon';

-- AlterTable
ALTER TABLE "booking_items" ADD COLUMN     "package_departure_id" UUID,
ADD COLUMN     "seat_state" "SeatState",
ADD COLUMN     "seats" INTEGER,
ADD COLUMN     "tour_departure_id" UUID;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "linked_booking_id" UUID;

-- CreateTable
CREATE TABLE "packages" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "city_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "nights" INTEGER NOT NULL,
    "passport_required" BOOLEAN NOT NULL DEFAULT true,
    "art_key" TEXT,
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "itinerary" JSONB NOT NULL DEFAULT '[]',
    "inclusions" JSONB NOT NULL DEFAULT '[]',
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "cancellation_policy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_departures" (
    "id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "seats_reserved" INTEGER NOT NULL DEFAULT 0,
    "seats_sold" INTEGER NOT NULL DEFAULT 0,
    "prices" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "from_price_minor" BIGINT NOT NULL,
    "status" "DepartureStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "package_departures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tours" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "city_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "category" TEXT,
    "art_key" TEXT,
    "meeting_point" JSONB NOT NULL,
    "highlights" JSONB NOT NULL DEFAULT '[]',
    "inclusions" JSONB NOT NULL DEFAULT '[]',
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "cancellation_policy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tour_departures" (
    "id" UUID NOT NULL,
    "tour_id" UUID NOT NULL,
    "starts_at_local" TEXT NOT NULL,
    "starts_at_utc" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "seats_reserved" INTEGER NOT NULL DEFAULT 0,
    "seats_sold" INTEGER NOT NULL DEFAULT 0,
    "prices" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "from_price_minor" BIGINT NOT NULL,
    "status" "DepartureStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tour_departures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addons" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "type" "AddonProductType" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "country_codes" CHAR(2)[],
    "pricing_basis" "AddonPricingBasis" NOT NULL,
    "price" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "max_travellers" INTEGER NOT NULL DEFAULT 9,
    "required_details" JSONB NOT NULL DEFAULT '[]',
    "cancellation_policy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_rules" (
    "id" UUID NOT NULL,
    "nationality" CHAR(2) NOT NULL,
    "destination" CHAR(2) NOT NULL,
    "purpose" "VisaPurpose" NOT NULL,
    "requirement" "VisaRequirement" NOT NULL,
    "max_stay_days" INTEGER,
    "notes" TEXT,
    "verified_at" DATE,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visa_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_products" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "destination" CHAR(2) NOT NULL,
    "purposes" "VisaPurpose"[],
    "processing_days_min" INTEGER NOT NULL,
    "processing_days_max" INTEGER NOT NULL,
    "price" JSONB NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "checklist" JSONB NOT NULL,
    "government_fee_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visa_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_applications" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "applicant_position" INTEGER NOT NULL,
    "status" "VisaApplicationStatus" NOT NULL DEFAULT 'awaiting_documents',
    "purpose" "VisaPurpose" NOT NULL,
    "nationality" CHAR(2) NOT NULL,
    "destination" CHAR(2) NOT NULL,
    "travel_date" DATE NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visa_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_application_events" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "from_status" "VisaApplicationStatus",
    "to_status" "VisaApplicationStatus",
    "message" TEXT,
    "note" TEXT,
    "actor_type" "BookingActorType" NOT NULL,
    "actor_user_id" UUID,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visa_application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visa_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "checklist_key" TEXT NOT NULL,
    "status" "VisaDocumentStatus" NOT NULL DEFAULT 'pending_scan',
    "storage_key" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "wrapped_key" TEXT NOT NULL,
    "file_name_encrypted" TEXT NOT NULL,
    "uploaded_by_user_id" UUID,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanned_at" TIMESTAMPTZ(3),
    "scan_attempts" INTEGER NOT NULL DEFAULT 0,
    "superseded_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "visa_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_vouchers" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_encrypted" TEXT NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3),
    "redeemed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packages_slug_key" ON "packages"("slug");

-- CreateIndex
CREATE INDEX "packages_status_country_code_idx" ON "packages"("status", "country_code");

-- CreateIndex
CREATE INDEX "packages_city_id_idx" ON "packages"("city_id");

-- CreateIndex
CREATE INDEX "package_departures_package_id_start_date_idx" ON "package_departures"("package_id", "start_date");

-- CreateIndex
CREATE INDEX "package_departures_status_start_date_idx" ON "package_departures"("status", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "tours_slug_key" ON "tours"("slug");

-- CreateIndex
CREATE INDEX "tours_status_country_code_idx" ON "tours"("status", "country_code");

-- CreateIndex
CREATE INDEX "tours_city_id_idx" ON "tours"("city_id");

-- CreateIndex
CREATE INDEX "tour_departures_tour_id_starts_at_utc_idx" ON "tour_departures"("tour_id", "starts_at_utc");

-- CreateIndex
CREATE INDEX "tour_departures_status_starts_at_utc_idx" ON "tour_departures"("status", "starts_at_utc");

-- CreateIndex
CREATE UNIQUE INDEX "addons_slug_key" ON "addons"("slug");

-- CreateIndex
CREATE INDEX "addons_status_type_idx" ON "addons"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "visa_rules_nationality_destination_purpose_key" ON "visa_rules"("nationality", "destination", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "visa_products_slug_key" ON "visa_products"("slug");

-- CreateIndex
CREATE INDEX "visa_products_status_destination_idx" ON "visa_products"("status", "destination");

-- CreateIndex
CREATE INDEX "visa_applications_status_updated_at_idx" ON "visa_applications"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "visa_applications_booking_id_applicant_position_key" ON "visa_applications"("booking_id", "applicant_position");

-- CreateIndex
CREATE INDEX "visa_application_events_application_id_occurred_at_idx" ON "visa_application_events"("application_id", "occurred_at");

-- CreateIndex
CREATE INDEX "visa_documents_application_id_checklist_key_idx" ON "visa_documents"("application_id", "checklist_key");

-- CreateIndex
CREATE INDEX "visa_documents_status_uploaded_at_idx" ON "visa_documents"("status", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "booking_vouchers_code_hash_key" ON "booking_vouchers"("code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "booking_vouchers_booking_item_id_key" ON "booking_vouchers"("booking_item_id");

-- CreateIndex
CREATE INDEX "booking_items_package_departure_id_idx" ON "booking_items"("package_departure_id");

-- CreateIndex
CREATE INDEX "booking_items_tour_departure_id_idx" ON "booking_items"("tour_departure_id");

-- CreateIndex
CREATE INDEX "bookings_linked_booking_id_idx" ON "bookings"("linked_booking_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_linked_booking_id_fkey" FOREIGN KEY ("linked_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_package_departure_id_fkey" FOREIGN KEY ("package_departure_id") REFERENCES "package_departures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_tour_departure_id_fkey" FOREIGN KEY ("tour_departure_id") REFERENCES "tour_departures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "packages" ADD CONSTRAINT "packages_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_departures" ADD CONSTRAINT "package_departures_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tours" ADD CONSTRAINT "tours_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tour_departures" ADD CONSTRAINT "tour_departures_tour_id_fkey" FOREIGN KEY ("tour_id") REFERENCES "tours"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_applications" ADD CONSTRAINT "visa_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "visa_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_application_events" ADD CONSTRAINT "visa_application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visa_documents" ADD CONSTRAINT "visa_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "visa_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_vouchers" ADD CONSTRAINT "booking_vouchers_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_vouchers" ADD CONSTRAINT "booking_vouchers_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written constraints (Prisma does not manage CHECK constraints).
-- Seat counters: two buyers can never take the same last seat (ADR-025).
ALTER TABLE "package_departures" ADD CONSTRAINT "package_departures_seats_valid" CHECK ("capacity" >= 0 AND "seats_reserved" >= 0 AND "seats_sold" >= 0 AND "seats_reserved" + "seats_sold" <= "capacity");
ALTER TABLE "tour_departures" ADD CONSTRAINT "tour_departures_seats_valid" CHECK ("capacity" >= 0 AND "seats_reserved" >= 0 AND "seats_sold" >= 0 AND "seats_reserved" + "seats_sold" <= "capacity");
ALTER TABLE "package_departures" ADD CONSTRAINT "package_departures_dates_valid" CHECK ("end_date" >= "start_date" AND "from_price_minor" > 0);
ALTER TABLE "tour_departures" ADD CONSTRAINT "tour_departures_price_valid" CHECK ("from_price_minor" > 0);
ALTER TABLE "packages" ADD CONSTRAINT "packages_nights_valid" CHECK ("nights" BETWEEN 0 AND 60);
ALTER TABLE "tours" ADD CONSTRAINT "tours_duration_valid" CHECK ("duration_minutes" BETWEEN 1 AND 20160);
ALTER TABLE "addons" ADD CONSTRAINT "addons_values_valid" CHECK ("price_minor" > 0 AND "max_travellers" BETWEEN 1 AND 50);
ALTER TABLE "visa_products" ADD CONSTRAINT "visa_products_values_valid" CHECK ("price_minor" > 0 AND "processing_days_min" >= 0 AND "processing_days_max" >= "processing_days_min");
ALTER TABLE "visa_rules" ADD CONSTRAINT "visa_rules_values_valid" CHECK ("nationality" <> "destination" AND ("max_stay_days" IS NULL OR "max_stay_days" > 0));
-- A booking item holds seats on at most one departure, and seats and their state go together.
ALTER TABLE "booking_items" ADD CONSTRAINT "booking_items_seats_valid" CHECK (("seats" IS NULL) = ("seat_state" IS NULL) AND ("seats" IS NULL OR "seats" > 0) AND NOT ("package_departure_id" IS NOT NULL AND "tour_departure_id" IS NOT NULL));
ALTER TABLE "visa_documents" ADD CONSTRAINT "visa_documents_size_valid" CHECK ("size_bytes" > 0);
