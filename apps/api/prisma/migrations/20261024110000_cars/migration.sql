-- Cars: interstate buses, intrastate rides and car rental (ADR-049 to ADR-053).
-- Proximity search uses earthdistance on cube (ADR-053); rental periods use btree_gist.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "BusTripStatus" AS ENUM ('scheduled', 'boarding', 'departed', 'cancelled');

-- CreateEnum
CREATE TYPE "BusTicketStatus" AS ENUM ('valid', 'boarded', 'void');

-- CreateEnum
CREATE TYPE "RideCategory" AS ENUM ('standard', 'comfort', 'xl');

-- CreateEnum
CREATE TYPE "RideStatus" AS ENUM ('scheduled', 'searching', 'assigned', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_driver');

-- CreateEnum
CREATE TYPE "RideOfferStatus" AS ENUM ('open', 'accepted', 'declined', 'expired', 'withdrawn');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "DriverDocumentKind" AS ENUM ('licence', 'vehicle_registration', 'insurance', 'roadworthiness', 'selfie');

-- CreateEnum
CREATE TYPE "DriverDocumentStatus" AS ENUM ('pending', 'clean', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('sos', 'route_deviation', 'pin_lockout', 'long_stop');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'acknowledged', 'resolved');

-- CreateEnum
CREATE TYPE "RentalCategory" AS ENUM ('economy', 'compact', 'suv', 'luxury', 'van');

-- CreateEnum
CREATE TYPE "Transmission" AS ENUM ('automatic', 'manual');

-- CreateEnum
CREATE TYPE "RentalStatus" AS ENUM ('reserved', 'checked_out', 'returned', 'cancelled');

-- CreateEnum
CREATE TYPE "HandoverKind" AS ENUM ('check_out', 'check_in');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'paid', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BookingItemType" ADD VALUE 'bus';
ALTER TYPE "BookingItemType" ADD VALUE 'ride';
ALTER TYPE "BookingItemType" ADD VALUE 'rental';

-- CreateTable
CREATE TABLE "bus_operators" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "cancellation_policy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_members" (
    "operator_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operator_members_pkey" PRIMARY KEY ("operator_id","user_id")
);

-- CreateTable
CREATE TABLE "bus_terminals" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city_name" TEXT NOT NULL,
    "state_name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "time_zone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_routes" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "origin_terminal_id" UUID NOT NULL,
    "destination_terminal_id" UUID NOT NULL,
    "distance_km" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_layouts" (
    "id" UUID NOT NULL,
    "operator_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "seat_count" INTEGER NOT NULL,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_trips" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "layout_id" UUID NOT NULL,
    "departs_at" TIMESTAMPTZ(3) NOT NULL,
    "departs_at_local" TEXT NOT NULL,
    "arrives_at" TIMESTAMPTZ(3) NOT NULL,
    "fare_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BusTripStatus" NOT NULL DEFAULT 'scheduled',
    "blocked_seats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bus_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_seat_holds" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seats" TEXT[],
    "user_id" UUID,
    "guest_token_hash" TEXT,
    "ip_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "booking_item_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_seat_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_seat_assignments" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seat_number" TEXT NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_seat_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_tickets" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "seat_number" TEXT NOT NULL,
    "passenger_id" UUID NOT NULL,
    "status" "BusTicketStatus" NOT NULL DEFAULT 'valid',
    "boarded_at" TIMESTAMPTZ(3),
    "boarded_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_ticket_scans" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "agent_user_id" UUID NOT NULL,
    "scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "result" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bus_ticket_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_places" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "city_name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ride_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_fare_rules" (
    "id" UUID NOT NULL,
    "city_name" TEXT NOT NULL,
    "category" "RideCategory" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "per_km_minor" BIGINT NOT NULL,
    "per_minute_minor" BIGINT NOT NULL,
    "booking_fee_minor" BIGINT NOT NULL,
    "minimum_minor" BIGINT NOT NULL,
    "cancellation_fee_minor" BIGINT NOT NULL,
    "free_cancel_seconds" INTEGER NOT NULL,
    "wait_grace_seconds" INTEGER NOT NULL,
    "driver_share_bps" INTEGER NOT NULL,
    "surge_bps" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ride_fare_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'pending',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "given_names" TEXT NOT NULL,
    "surname" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "city_name" TEXT NOT NULL,
    "nin_encrypted" TEXT NOT NULL,
    "nin_hash" TEXT NOT NULL,
    "identity_check" TEXT NOT NULL DEFAULT 'pending',
    "identity_reference" TEXT,
    "licence_encrypted" TEXT NOT NULL,
    "licence_hash" TEXT NOT NULL,
    "licence_expires_on" DATE NOT NULL,
    "licence_check" TEXT NOT NULL DEFAULT 'pending',
    "licence_reference" TEXT,
    "payout_account_encrypted" TEXT,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "last_location_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "status_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_vehicles" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "colour" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "category" "RideCategory" NOT NULL,
    "seats" INTEGER NOT NULL,
    "insurance_expires_on" DATE NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "driver_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "kind" "DriverDocumentKind" NOT NULL,
    "status" "DriverDocumentStatus" NOT NULL DEFAULT 'pending',
    "storage_key" TEXT,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "wrapped_key" TEXT NOT NULL,
    "expires_on" DATE,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "superseded_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rides" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "rider_user_id" UUID NOT NULL,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "category" "RideCategory" NOT NULL,
    "status" "RideStatus" NOT NULL,
    "city_name" TEXT NOT NULL,
    "pickup_label" TEXT NOT NULL,
    "pickup_lat" DOUBLE PRECISION NOT NULL,
    "pickup_lng" DOUBLE PRECISION NOT NULL,
    "dropoff_label" TEXT NOT NULL,
    "dropoff_lat" DOUBLE PRECISION NOT NULL,
    "dropoff_lng" DOUBLE PRECISION NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3),
    "polyline" TEXT NOT NULL,
    "distance_metres" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "fare_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "pin_hash" TEXT NOT NULL,
    "pin_encrypted" TEXT NOT NULL,
    "pin_attempts" INTEGER NOT NULL DEFAULT 0,
    "pin_locked_at" TIMESTAMPTZ(3),
    "search_started_at" TIMESTAMPTZ(3),
    "assigned_at" TIMESTAMPTZ(3),
    "arrived_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" TEXT,
    "cancellation_fee_minor" BIGINT,
    "off_route_since" TIMESTAMPTZ(3),
    "locations_redacted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_events" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "from_status" "RideStatus" NOT NULL,
    "to_status" "RideStatus" NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_user_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_offers" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "status" "RideOfferStatus" NOT NULL DEFAULT 'open',
    "distance_metres" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_location_pings" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_location_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_ratings" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "rater_kind" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_share_links" (
    "id" UUID NOT NULL,
    "ride_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ride_share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_incidents" (
    "id" UUID NOT NULL,
    "kind" "IncidentKind" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "ride_id" UUID,
    "reporter_user_id" UUID,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "contact_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payouts" (
    "id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "failure_reason" TEXT,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_vehicles" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "category" "RentalCategory" NOT NULL,
    "transmission" "Transmission" NOT NULL,
    "seats" INTEGER NOT NULL,
    "plate" TEXT NOT NULL,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "art_key" TEXT,
    "city_name" TEXT NOT NULL,
    "branch_name" TEXT NOT NULL,
    "branch_address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "time_zone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "daily_minor" BIGINT NOT NULL,
    "chauffeur_daily_minor" BIGINT,
    "deposit_minor" BIGINT NOT NULL,
    "cancellation_policy" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_reservations" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "pickup_at" TIMESTAMPTZ(3) NOT NULL,
    "return_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3) NOT NULL,
    "chauffeur" BOOLEAN NOT NULL,
    "status" "RentalStatus" NOT NULL DEFAULT 'reserved',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deposit_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "deposit_released_at" TIMESTAMPTZ(3),
    "deposit_deduction_minor" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rental_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_handovers" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "kind" "HandoverKind" NOT NULL,
    "odometer_km" INTEGER NOT NULL,
    "fuel_eighths" INTEGER NOT NULL,
    "damage_notes" TEXT,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bus_operators_slug_key" ON "bus_operators"("slug");

-- CreateIndex
CREATE INDEX "operator_members_user_id_idx" ON "operator_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bus_terminals_slug_key" ON "bus_terminals"("slug");

-- CreateIndex
CREATE INDEX "bus_terminals_city_name_idx" ON "bus_terminals"("city_name");

-- CreateIndex
CREATE INDEX "bus_routes_origin_terminal_id_destination_terminal_id_idx" ON "bus_routes"("origin_terminal_id", "destination_terminal_id");

-- CreateIndex
CREATE UNIQUE INDEX "bus_routes_operator_id_origin_terminal_id_destination_termi_key" ON "bus_routes"("operator_id", "origin_terminal_id", "destination_terminal_id");

-- CreateIndex
CREATE INDEX "bus_layouts_operator_id_idx" ON "bus_layouts"("operator_id");

-- CreateIndex
CREATE INDEX "bus_trips_route_id_departs_at_idx" ON "bus_trips"("route_id", "departs_at");

-- CreateIndex
CREATE INDEX "bus_trips_status_departs_at_idx" ON "bus_trips"("status", "departs_at");

-- CreateIndex
CREATE UNIQUE INDEX "bus_seat_holds_booking_item_id_key" ON "bus_seat_holds"("booking_item_id");

-- CreateIndex
CREATE INDEX "bus_seat_holds_trip_id_expires_at_idx" ON "bus_seat_holds"("trip_id", "expires_at");

-- CreateIndex
CREATE INDEX "bus_seat_holds_user_id_expires_at_idx" ON "bus_seat_holds"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "bus_seat_holds_ip_hash_expires_at_idx" ON "bus_seat_holds"("ip_hash", "expires_at");

-- CreateIndex
CREATE INDEX "bus_seat_holds_expires_at_idx" ON "bus_seat_holds"("expires_at");

-- CreateIndex
CREATE INDEX "bus_seat_assignments_booking_item_id_idx" ON "bus_seat_assignments"("booking_item_id");

-- CreateIndex
CREATE INDEX "bus_seat_assignments_trip_id_idx" ON "bus_seat_assignments"("trip_id");

-- CreateIndex
CREATE INDEX "bus_tickets_booking_item_id_idx" ON "bus_tickets"("booking_item_id");

-- CreateIndex
CREATE INDEX "bus_tickets_trip_id_idx" ON "bus_tickets"("trip_id");

-- CreateIndex
CREATE INDEX "bus_ticket_scans_ticket_id_idx" ON "bus_ticket_scans"("ticket_id");

-- CreateIndex
CREATE INDEX "bus_ticket_scans_created_at_idx" ON "bus_ticket_scans"("created_at");

-- CreateIndex
CREATE INDEX "ride_places_city_name_active_idx" ON "ride_places"("city_name", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ride_fare_rules_city_name_category_key" ON "ride_fare_rules"("city_name", "category");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_user_id_key" ON "drivers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_nin_hash_key" ON "drivers"("nin_hash");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_licence_hash_key" ON "drivers"("licence_hash");

-- CreateIndex
CREATE INDEX "drivers_status_online_idx" ON "drivers"("status", "online");

-- CreateIndex
CREATE UNIQUE INDEX "driver_vehicles_plate_key" ON "driver_vehicles"("plate");

-- CreateIndex
CREATE INDEX "driver_vehicles_driver_id_idx" ON "driver_vehicles"("driver_id");

-- CreateIndex
CREATE INDEX "driver_documents_driver_id_kind_idx" ON "driver_documents"("driver_id", "kind");

-- CreateIndex
CREATE INDEX "driver_documents_status_created_at_idx" ON "driver_documents"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "rides_booking_id_key" ON "rides"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "rides_booking_item_id_key" ON "rides"("booking_item_id");

-- CreateIndex
CREATE INDEX "rides_status_scheduled_for_idx" ON "rides"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "rides_rider_user_id_created_at_idx" ON "rides"("rider_user_id", "created_at");

-- CreateIndex
CREATE INDEX "rides_driver_id_created_at_idx" ON "rides"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "rides_completed_at_idx" ON "rides"("completed_at");

-- CreateIndex
CREATE INDEX "ride_events_ride_id_created_at_idx" ON "ride_events"("ride_id", "created_at");

-- CreateIndex
CREATE INDEX "ride_offers_driver_id_status_idx" ON "ride_offers"("driver_id", "status");

-- CreateIndex
CREATE INDEX "ride_offers_status_expires_at_idx" ON "ride_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "ride_offers_created_at_idx" ON "ride_offers"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ride_offers_ride_id_driver_id_key" ON "ride_offers"("ride_id", "driver_id");

-- CreateIndex
CREATE INDEX "ride_location_pings_ride_id_recorded_at_idx" ON "ride_location_pings"("ride_id", "recorded_at");

-- CreateIndex
CREATE INDEX "ride_location_pings_created_at_idx" ON "ride_location_pings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ride_ratings_ride_id_rater_kind_key" ON "ride_ratings"("ride_id", "rater_kind");

-- CreateIndex
CREATE UNIQUE INDEX "ride_share_links_token_hash_key" ON "ride_share_links"("token_hash");

-- CreateIndex
CREATE INDEX "ride_share_links_ride_id_idx" ON "ride_share_links"("ride_id");

-- CreateIndex
CREATE INDEX "ride_share_links_expires_at_idx" ON "ride_share_links"("expires_at");

-- CreateIndex
CREATE INDEX "safety_incidents_status_created_at_idx" ON "safety_incidents"("status", "created_at");

-- CreateIndex
CREATE INDEX "safety_incidents_ride_id_idx" ON "safety_incidents"("ride_id");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_contacts_user_id_position_key" ON "emergency_contacts"("user_id", "position");

-- CreateIndex
CREATE INDEX "driver_payouts_driver_id_created_at_idx" ON "driver_payouts"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "driver_payouts_status_idx" ON "driver_payouts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "rental_vehicles_slug_key" ON "rental_vehicles"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "rental_vehicles_plate_key" ON "rental_vehicles"("plate");

-- CreateIndex
CREATE INDEX "rental_vehicles_city_name_status_idx" ON "rental_vehicles"("city_name", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rental_reservations_booking_item_id_key" ON "rental_reservations"("booking_item_id");

-- CreateIndex
CREATE INDEX "rental_reservations_vehicle_id_pickup_at_idx" ON "rental_reservations"("vehicle_id", "pickup_at");

-- CreateIndex
CREATE UNIQUE INDEX "rental_handovers_reservation_id_kind_key" ON "rental_handovers"("reservation_id", "kind");

-- AddForeignKey
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "bus_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_members" ADD CONSTRAINT "operator_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_routes" ADD CONSTRAINT "bus_routes_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "bus_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_routes" ADD CONSTRAINT "bus_routes_origin_terminal_id_fkey" FOREIGN KEY ("origin_terminal_id") REFERENCES "bus_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_routes" ADD CONSTRAINT "bus_routes_destination_terminal_id_fkey" FOREIGN KEY ("destination_terminal_id") REFERENCES "bus_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_layouts" ADD CONSTRAINT "bus_layouts_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "bus_operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_trips" ADD CONSTRAINT "bus_trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "bus_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_trips" ADD CONSTRAINT "bus_trips_layout_id_fkey" FOREIGN KEY ("layout_id") REFERENCES "bus_layouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_seat_holds" ADD CONSTRAINT "bus_seat_holds_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "bus_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_seat_assignments" ADD CONSTRAINT "bus_seat_assignments_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "bus_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_seat_assignments" ADD CONSTRAINT "bus_seat_assignments_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_tickets" ADD CONSTRAINT "bus_tickets_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_tickets" ADD CONSTRAINT "bus_tickets_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_tickets" ADD CONSTRAINT "bus_tickets_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "bus_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_ticket_scans" ADD CONSTRAINT "bus_ticket_scans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "bus_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_user_id_fkey" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "driver_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_location_pings" ADD CONSTRAINT "ride_location_pings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_share_links" ADD CONSTRAINT "ride_share_links_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_incidents" ADD CONSTRAINT "safety_incidents_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_reservations" ADD CONSTRAINT "rental_reservations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "rental_vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_reservations" ADD CONSTRAINT "rental_reservations_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_handovers" ADD CONSTRAINT "rental_handovers_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "rental_reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Constraints and indexes Prisma cannot express ------------------------------------------------

-- A seat is sold once per trip; released assignments and voided tickets stay as history.
CREATE UNIQUE INDEX "bus_seat_assignments_live_seat" ON "bus_seat_assignments" ("trip_id", "seat_number") WHERE "active";
CREATE UNIQUE INDEX "bus_tickets_live_seat" ON "bus_tickets" ("trip_id", "seat_number") WHERE "status" <> 'void';

-- One open offer per ride and per driver, so exactly one acceptance can win.
CREATE UNIQUE INDEX "ride_offers_open_ride" ON "ride_offers" ("ride_id") WHERE "status" = 'open';
CREATE UNIQUE INDEX "ride_offers_open_driver" ON "ride_offers" ("driver_id") WHERE "status" = 'open';

-- A driver drives one ride at a time, and a rider takes one live ride at a time.
CREATE UNIQUE INDEX "rides_driver_live" ON "rides" ("driver_id") WHERE "status" IN ('assigned', 'arrived', 'in_progress');
CREATE UNIQUE INDEX "rides_rider_live" ON "rides" ("rider_user_id") WHERE "status" IN ('searching', 'assigned', 'arrived', 'in_progress');

-- One active vehicle per driver.
CREATE UNIQUE INDEX "driver_vehicles_one_active" ON "driver_vehicles" ("driver_id") WHERE "active";

-- Nearest online drivers (ADR-053): earth_box @> ll_to_earth uses this index.
CREATE INDEX "drivers_last_position" ON "drivers" USING gist (ll_to_earth("last_lat", "last_lng")) WHERE "online" AND "last_lat" IS NOT NULL;

-- Active rental periods of one car never overlap (turnaround buffer included).
ALTER TABLE "rental_reservations" ADD CONSTRAINT "rental_reservations_no_overlap" EXCLUDE USING gist ("vehicle_id" WITH =, tstzrange("pickup_at", "blocked_until") WITH &&) WHERE ("active");

ALTER TABLE "bus_terminals" ADD CONSTRAINT "bus_terminals_position_valid" CHECK ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
ALTER TABLE "bus_routes" ADD CONSTRAINT "bus_routes_values_valid" CHECK ("origin_terminal_id" <> "destination_terminal_id" AND "distance_km" > 0 AND "duration_minutes" > 0);
ALTER TABLE "bus_layouts" ADD CONSTRAINT "bus_layouts_seats_valid" CHECK ("seat_count" BETWEEN 1 AND 120);
ALTER TABLE "bus_trips" ADD CONSTRAINT "bus_trips_values_valid" CHECK ("fare_minor" > 0 AND "arrives_at" > "departs_at");
ALTER TABLE "bus_seat_holds" ADD CONSTRAINT "bus_seat_holds_one_holder" CHECK (("user_id" IS NULL) <> ("guest_token_hash" IS NULL) AND cardinality("seats") BETWEEN 1 AND 6);
ALTER TABLE "ride_places" ADD CONSTRAINT "ride_places_values_valid" CHECK ("kind" IN ('airport', 'terminal', 'landmark') AND "lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180);
ALTER TABLE "ride_fare_rules" ADD CONSTRAINT "ride_fare_rules_values_valid" CHECK ("base_minor" >= 0 AND "per_km_minor" >= 0 AND "per_minute_minor" >= 0 AND "booking_fee_minor" >= 0 AND "minimum_minor" >= 0 AND "cancellation_fee_minor" >= 0 AND "free_cancel_seconds" >= 0 AND "wait_grace_seconds" >= 0 AND "driver_share_bps" BETWEEN 0 AND 10000 AND "surge_bps" >= 0);
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_rating_valid" CHECK ("rating_sum" >= 0 AND "rating_count" >= 0 AND "rating_sum" <= 5 * "rating_count");
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_position_valid" CHECK (("last_lat" IS NULL) = ("last_lng" IS NULL) AND ("last_lat" IS NULL OR ("last_lat" BETWEEN -90 AND 90 AND "last_lng" BETWEEN -180 AND 180)));
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_values_valid" CHECK ("seats" BETWEEN 2 AND 20 AND "year" BETWEEN 1980 AND 2100);
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_size_valid" CHECK ("size_bytes" > 0);
ALTER TABLE "rides" ADD CONSTRAINT "rides_values_valid" CHECK ("fare_minor" > 0 AND "distance_metres" >= 0 AND "duration_seconds" >= 0 AND "pin_attempts" >= 0 AND ("cancellation_fee_minor" IS NULL OR "cancellation_fee_minor" >= 0));
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_when_matched" CHECK ("status" IN ('scheduled', 'searching', 'cancelled', 'no_driver') OR "driver_id" IS NOT NULL);
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_values_valid" CHECK ("stars" BETWEEN 1 AND 5 AND "rater_kind" IN ('rider', 'driver'));
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_amount_positive" CHECK ("amount_minor" > 0);
ALTER TABLE "rental_vehicles" ADD CONSTRAINT "rental_vehicles_values_valid" CHECK ("daily_minor" > 0 AND "deposit_minor" >= 0 AND ("chauffeur_daily_minor" IS NULL OR "chauffeur_daily_minor" > 0) AND "seats" BETWEEN 2 AND 20);
ALTER TABLE "rental_reservations" ADD CONSTRAINT "rental_reservations_period_valid" CHECK ("return_at" > "pickup_at" AND "blocked_until" >= "return_at" AND "deposit_minor" >= 0 AND ("deposit_deduction_minor" IS NULL OR "deposit_deduction_minor" BETWEEN 0 AND "deposit_minor"));
ALTER TABLE "rental_handovers" ADD CONSTRAINT "rental_handovers_values_valid" CHECK ("odometer_km" >= 0 AND "fuel_eighths" BETWEEN 0 AND 8);
