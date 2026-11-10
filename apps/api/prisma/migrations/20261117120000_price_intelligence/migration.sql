-- Price intelligence (ADR-102): sites whose public prices may be read, the policy for each,
-- what was asked, tried and seen, and what reading may cost. Expand-only: six new tables and
-- their types; the revision still serving reads none of them.

-- CreateEnum
CREATE TYPE "SourcePolicyStatus" AS ENUM ('review', 'approved', 'blocked');

-- CreateEnum
CREATE TYPE "ScrapeJobStatus" AS ENUM ('running', 'succeeded', 'exhausted', 'denied', 'failed');

-- CreateEnum
CREATE TYPE "PriceObservationStatus" AS ENUM ('verified', 'unverified', 'rejected');

-- CreateTable
CREATE TABLE "price_sources" (
    "id" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "products" TEXT[],
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "locale" VARCHAR(12) NOT NULL,
    "url_templates" JSONB NOT NULL,
    "recipes" JSONB NOT NULL,
    "vendor_settings" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "price_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_policies" (
    "source_id" UUID NOT NULL,
    "status" "SourcePolicyStatus" NOT NULL DEFAULT 'review',
    "basis" VARCHAR(32),
    "basis_reference" VARCHAR(200),
    "robots" VARCHAR(16) NOT NULL DEFAULT 'unknown',
    "terms" VARCHAR(16) NOT NULL DEFAULT 'unknown',
    "vendors" TEXT[],
    "max_proxy_class" VARCHAR(16) NOT NULL DEFAULT 'none',
    "requests_per_minute" INTEGER NOT NULL DEFAULT 6,
    "max_concurrency" INTEGER NOT NULL DEFAULT 1,
    "night_start_hour" SMALLINT NOT NULL DEFAULT 1,
    "night_end_hour" SMALLINT NOT NULL DEFAULT 5,
    "time_zone" VARCHAR(64) NOT NULL,
    "freshness_minutes" JSONB NOT NULL,
    "decided_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "source_policies_pkey" PRIMARY KEY ("source_id")
);

-- CreateTable
CREATE TABLE "scrape_jobs" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "product" VARCHAR(16) NOT NULL,
    "canonical_key" VARCHAR(64) NOT NULL,
    "query" JSONB NOT NULL,
    "trigger" VARCHAR(16) NOT NULL,
    "status" "ScrapeJobStatus" NOT NULL DEFAULT 'running',
    "failure_class" VARCHAR(24),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "observation_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "scrape_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_attempts" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "vendor" VARCHAR(16) NOT NULL,
    "proxy_class" VARCHAR(16) NOT NULL,
    "outcome" VARCHAR(24) NOT NULL,
    "http_status" INTEGER,
    "rendered" BOOLEAN NOT NULL DEFAULT false,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "snapshot_key" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scrape_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_observations" (
    "id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "job_id" UUID,
    "product" VARCHAR(16) NOT NULL,
    "canonical_key" VARCHAR(64) NOT NULL,
    "item_key" VARCHAR(64) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "taxes_included" BOOLEAN,
    "availability" VARCHAR(16) NOT NULL DEFAULT 'unknown',
    "item" JSONB NOT NULL,
    "vendor" VARCHAR(16) NOT NULL,
    "proxy_class" VARCHAR(16) NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "parser_version" VARCHAR(32) NOT NULL,
    "confidence" SMALLINT NOT NULL,
    "status" "PriceObservationStatus" NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "snapshot_hash" VARCHAR(64) NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "fresh_until" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_budgets" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(8) NOT NULL,
    "subject" VARCHAR(253) NOT NULL,
    "daily_cap_micro_usd" BIGINT NOT NULL,
    "monthly_cap_micro_usd" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "price_sources_domain_key" ON "price_sources"("domain");

-- CreateIndex
CREATE INDEX "source_policies_status_idx" ON "source_policies"("status");

-- CreateIndex
CREATE INDEX "scrape_jobs_source_id_started_at_idx" ON "scrape_jobs"("source_id", "started_at");

-- CreateIndex
CREATE INDEX "scrape_jobs_canonical_key_started_at_idx" ON "scrape_jobs"("canonical_key", "started_at");

-- CreateIndex
CREATE INDEX "scrape_jobs_started_at_idx" ON "scrape_jobs"("started_at");

-- CreateIndex
CREATE INDEX "scrape_attempts_job_id_id_idx" ON "scrape_attempts"("job_id", "id");

-- CreateIndex
CREATE INDEX "scrape_attempts_vendor_created_at_idx" ON "scrape_attempts"("vendor", "created_at");

-- CreateIndex
CREATE INDEX "scrape_attempts_snapshot_key_created_at_idx" ON "scrape_attempts"("snapshot_key", "created_at");

-- CreateIndex
CREATE INDEX "price_observations_canonical_key_observed_at_idx" ON "price_observations"("canonical_key", "observed_at");

-- CreateIndex
CREATE INDEX "price_observations_source_id_product_item_key_observed_at_idx" ON "price_observations"("source_id", "product", "item_key", "observed_at");

-- CreateIndex
CREATE INDEX "price_observations_observed_at_idx" ON "price_observations"("observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_budgets_scope_subject_key" ON "provider_budgets"("scope", "subject");

-- AddForeignKey
ALTER TABLE "source_policies" ADD CONSTRAINT "source_policies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "price_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_jobs" ADD CONSTRAINT "scrape_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "price_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scrape_attempts" ADD CONSTRAINT "scrape_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "scrape_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "price_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "scrape_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A price is positive, a score is a percentage and an hour is an hour: the database says so
-- whatever the application sends.
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_amount_minor_check" CHECK ("amount_minor" > 0);
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_confidence_check" CHECK ("confidence" BETWEEN 0 AND 100);
ALTER TABLE "source_policies" ADD CONSTRAINT "source_policies_night_hours_check" CHECK ("night_start_hour" BETWEEN 0 AND 23 AND "night_end_hour" BETWEEN 0 AND 23);
ALTER TABLE "source_policies" ADD CONSTRAINT "source_policies_rate_check" CHECK ("requests_per_minute" BETWEEN 1 AND 600 AND "max_concurrency" BETWEEN 1 AND 20);
ALTER TABLE "provider_budgets" ADD CONSTRAINT "provider_budgets_caps_check" CHECK ("daily_cap_micro_usd" >= 0 AND "monthly_cap_micro_usd" >= 0);
