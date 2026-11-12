-- Verified reviews (ADR-077). Expand only: new tables, a new enum value and two nullable
-- columns on bookings, so the revision still serving keeps working.
-- CreateEnum
CREATE TYPE "ReviewSubjectKind" AS ENUM ('hotel', 'package', 'tour', 'bus_operator', 'rental_vehicle');

-- CreateEnum
CREATE TYPE "TravellerReviewStatus" AS ENUM ('pending', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "ReviewTripType" AS ENUM ('solo', 'couple', 'family', 'friends', 'business');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'review_requests';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "review_invite_at" TIMESTAMPTZ(3),
ADD COLUMN     "review_invited_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "review_subjects" (
    "id" UUID NOT NULL,
    "kind" "ReviewSubjectKind" NOT NULL,
    "ref_id" UUID,
    "name_key" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "name" TEXT NOT NULL,
    "rating_sum" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "review_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "booking_item_id" UUID NOT NULL,
    "user_id" UUID,
    "rating" SMALLINT NOT NULL,
    "title" TEXT,
    "liked" TEXT,
    "disliked" TEXT,
    "trip_type" "ReviewTripType" NOT NULL,
    "display_name" TEXT,
    "locale" TEXT NOT NULL,
    "travelled_on" CHAR(7) NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TravellerReviewStatus" NOT NULL DEFAULT 'pending',
    "reject_reason" TEXT,
    "moderated_by_id" UUID,
    "moderated_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_subjects_kind_name_key_idx" ON "review_subjects"("kind", "name_key");

-- CreateIndex
CREATE UNIQUE INDEX "review_subjects_kind_ref_id_key" ON "review_subjects"("kind", "ref_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_item_id_key" ON "reviews"("booking_item_id");

-- CreateIndex
CREATE INDEX "reviews_subject_id_status_published_at_idx" ON "reviews"("subject_id", "status", "published_at");

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_user_id_idx" ON "reviews"("user_id");

-- CreateIndex
CREATE INDEX "reviews_booking_id_idx" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "bookings_status_review_invite_at_idx" ON "bookings"("status", "review_invite_at");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "review_subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_item_id_fkey" FOREIGN KEY ("booking_item_id") REFERENCES "booking_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
