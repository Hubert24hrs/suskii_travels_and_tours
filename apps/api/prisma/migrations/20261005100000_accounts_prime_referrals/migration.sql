-- Phase 9: accounts, Suskii Prime, referrals, notifications (ADR-029 to ADR-032).
-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('booking', 'payment', 'trip_reminder', 'price_alert', 'prime', 'marketing');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'sms', 'whatsapp', 'push');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('sent', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "PrimePeriod" AS ENUM ('month', 'year');

-- CreateEnum
CREATE TYPE "PrimeMembershipStatus" AS ENUM ('active', 'cancelled');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('pending', 'qualified', 'rewarded', 'review', 'rejected');

-- AlterEnum
ALTER TYPE "BookingItemType" ADD VALUE 'membership';

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'deleted';

-- AlterEnum
ALTER TYPE "Vertical" ADD VALUE 'prime';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "checkin_reminded_at" TIMESTAMPTZ(3),
ADD COLUMN     "redacted_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" UUID NOT NULL,
    "locale" TEXT,
    "currency" CHAR(3),
    "home_airport" CHAR(3),
    "marketing_consent_at" TIMESTAMPTZ(3),
    "marketing_consent_source" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category","channel")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "booking_id" UUID,
    "category" "NotificationCategory" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prime_plans" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "period" "PrimePeriod" NOT NULL,
    "prices" JSONB NOT NULL,
    "benefits" JSONB NOT NULL,
    "status" "CatalogStatus" NOT NULL DEFAULT 'draft',
    "sample" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prime_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prime_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "status" "PrimeMembershipStatus" NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "benefits" JSONB NOT NULL,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prime_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_codes" (
    "user_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_codes_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" UUID NOT NULL,
    "referrer_id" UUID NOT NULL,
    "referee_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'pending',
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signals" JSONB NOT NULL,
    "qualifying_booking_id" UUID,
    "qualified_at" TIMESTAMPTZ(3),
    "rewarded_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_alerts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "origin" CHAR(3) NOT NULL,
    "destination" CHAR(3) NOT NULL,
    "departure_date" DATE,
    "departure_month" TEXT,
    "cabin_class" "CabinClass" NOT NULL DEFAULT 'economy',
    "currency" CHAR(3) NOT NULL,
    "target_minor" BIGINT,
    "last_price_minor" BIGINT,
    "last_checked_at" TIMESTAMPTZ(3),
    "last_notified_at" TIMESTAMPTZ(3),
    "last_notified_minor" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ends_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_booking_id_idx" ON "notifications"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "prime_plans_slug_key" ON "prime_plans"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "prime_memberships_booking_id_key" ON "prime_memberships"("booking_id");

-- CreateIndex
CREATE INDEX "prime_memberships_user_id_ends_at_idx" ON "prime_memberships"("user_id", "ends_at");

-- CreateIndex
CREATE INDEX "prime_memberships_status_ends_at_idx" ON "prime_memberships"("status", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "referral_codes_code_key" ON "referral_codes"("code");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_referee_id_key" ON "referrals"("referee_id");

-- CreateIndex
CREATE INDEX "referrals_referrer_id_created_at_idx" ON "referrals"("referrer_id", "created_at");

-- CreateIndex
CREATE INDEX "referrals_status_idx" ON "referrals"("status");

-- CreateIndex
CREATE INDEX "price_alerts_user_id_idx" ON "price_alerts"("user_id");

-- CreateIndex
CREATE INDEX "price_alerts_active_last_checked_at_idx" ON "price_alerts"("active", "last_checked_at");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prime_memberships" ADD CONSTRAINT "prime_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prime_memberships" ADD CONSTRAINT "prime_memberships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "prime_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_fkey" FOREIGN KEY ("referee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Integrity the application relies on.
ALTER TABLE "prime_memberships"
  ADD CONSTRAINT "prime_memberships_term_check" CHECK ("ends_at" > "starts_at");
ALTER TABLE "price_alerts"
  ADD CONSTRAINT "price_alerts_when_check"
    CHECK (("departure_date" IS NULL) <> ("departure_month" IS NULL)),
  ADD CONSTRAINT "price_alerts_month_check"
    CHECK ("departure_month" IS NULL OR "departure_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "price_alerts_target_check" CHECK ("target_minor" IS NULL OR "target_minor" > 0);
ALTER TABLE "referrals"
  ADD CONSTRAINT "referrals_not_self_check" CHECK ("referrer_id" <> "referee_id");
ALTER TABLE "referral_codes"
  ADD CONSTRAINT "referral_codes_format_check" CHECK ("code" ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$');
