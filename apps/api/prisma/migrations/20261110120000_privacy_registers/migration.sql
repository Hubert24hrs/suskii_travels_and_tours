-- CreateEnum
CREATE TYPE "PrivacyRequestKind" AS ENUM ('access', 'rectification', 'erasure', 'objection', 'restriction', 'portability');

-- CreateEnum
CREATE TYPE "PrivacyRequestChannel" AS ENUM ('self_service', 'email', 'support', 'phone', 'post');

-- CreateEnum
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('open', 'completed', 'refused');

-- CreateEnum
CREATE TYPE "PrivacyRefusalReason" AS ENUM ('identity_not_verified', 'manifestly_unfounded', 'legal_obligation', 'no_data');

-- CreateEnum
CREATE TYPE "PrivacyJurisdiction" AS ENUM ('NG', 'KE', 'ZA', 'EU', 'GB', 'OTHER');

-- CreateEnum
CREATE TYPE "PrivacyBreachStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "BreachNoticeDecision" AS ENUM ('pending', 'notified', 'not_required');

-- AlterEnum
ALTER TYPE "RoleKey" ADD VALUE 'privacy_officer';

-- CreateTable
CREATE TABLE "privacy_requests" (
    "id" UUID NOT NULL,
    "kind" "PrivacyRequestKind" NOT NULL,
    "jurisdiction" "PrivacyJurisdiction" NOT NULL,
    "channel" "PrivacyRequestChannel" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'open',
    "user_id" UUID,
    "subject_email_ciphertext" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),
    "refusal_reason" "PrivacyRefusalReason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_breaches" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "details_ciphertext" TEXT NOT NULL,
    "aware_at" TIMESTAMPTZ(3) NOT NULL,
    "high_risk" BOOLEAN NOT NULL,
    "categories" TEXT[],
    "subjects_affected" INTEGER,
    "status" "PrivacyBreachStatus" NOT NULL DEFAULT 'open',
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "privacy_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "privacy_breach_notices" (
    "id" UUID NOT NULL,
    "breach_id" UUID NOT NULL,
    "jurisdiction" "PrivacyJurisdiction" NOT NULL,
    "regulator_due_at" TIMESTAMPTZ(3) NOT NULL,
    "decision" "BreachNoticeDecision" NOT NULL DEFAULT 'pending',
    "regulator_notified_at" TIMESTAMPTZ(3),
    "regulator_reference" VARCHAR(100),
    "subjects_notified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "privacy_breach_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "privacy_requests_status_due_at_idx" ON "privacy_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "privacy_requests_user_id_idx" ON "privacy_requests"("user_id");

-- CreateIndex
CREATE INDEX "privacy_breaches_status_aware_at_idx" ON "privacy_breaches"("status", "aware_at");

-- CreateIndex
CREATE INDEX "privacy_breach_notices_decision_regulator_due_at_idx" ON "privacy_breach_notices"("decision", "regulator_due_at");

-- CreateIndex
CREATE UNIQUE INDEX "privacy_breach_notices_breach_id_jurisdiction_key" ON "privacy_breach_notices"("breach_id", "jurisdiction");

-- AddForeignKey
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "privacy_breach_notices" ADD CONSTRAINT "privacy_breach_notices_breach_id_fkey" FOREIGN KEY ("breach_id") REFERENCES "privacy_breaches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

