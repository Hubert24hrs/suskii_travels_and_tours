-- Company accounts (ADR-078). Expand only: new tables and enums, and new columns on bookings
-- that are nullable or have defaults, so the revision still serving keeps working.

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('admin', 'approver', 'booker', 'traveller');

-- CreateEnum
CREATE TYPE "ApprovalMode" AS ENUM ('never', 'out_of_policy', 'always');

-- CreateEnum
CREATE TYPE "BookingApprovalStatus" AS ENUM ('not_required', 'pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "approval_decided_at" TIMESTAMPTZ(3),
ADD COLUMN     "approval_decided_by_id" UUID,
ADD COLUMN     "approval_reject_reason" TEXT,
ADD COLUMN     "approval_status" "BookingApprovalStatus" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "company_id" UUID,
ADD COLUMN     "policy_findings" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "registration_number" TEXT,
    "tax_id" TEXT,
    "billing_email" TEXT NOT NULL,
    "status" "CompanyStatus" NOT NULL DEFAULT 'active',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_members" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_invitations" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email_hash" TEXT NOT NULL,
    "email_hint" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" UUID,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_policies" (
    "company_id" UUID NOT NULL,
    "hotel_nightly_cap_minor" BIGINT,
    "hotel_nightly_currency" CHAR(3),
    "max_cabin" "CabinClass",
    "min_advance_days" INTEGER,
    "approval_mode" "ApprovalMode" NOT NULL DEFAULT 'never',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_policies_pkey" PRIMARY KEY ("company_id")
);

-- CreateIndex
CREATE INDEX "companies_status_created_at_idx" ON "companies"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_members_user_id_key" ON "company_members"("user_id");

-- CreateIndex
CREATE INDEX "company_members_company_id_role_idx" ON "company_members"("company_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "company_invitations_token_hash_key" ON "company_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "company_invitations_company_id_created_at_idx" ON "company_invitations"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "company_invitations_expires_at_idx" ON "company_invitations"("expires_at");

-- CreateIndex
CREATE INDEX "bookings_company_id_created_at_idx" ON "bookings"("company_id", "created_at");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_members" ADD CONSTRAINT "company_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_invitations" ADD CONSTRAINT "company_invitations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_policies" ADD CONSTRAINT "company_policies_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

