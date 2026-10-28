-- CreateEnum
CREATE TYPE "MetasearchLandingOutcome" AS ENUM ('same', 'lower', 'higher', 'unavailable', 'expired');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "metasearch_landing_id" UUID;

-- AlterTable
ALTER TABLE "offers" ADD COLUMN     "metasearch_landing_id" UUID;

-- CreateTable
CREATE TABLE "metasearch_partners" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requests_per_minute" INTEGER NOT NULL,
    "requests_per_day" INTEGER NOT NULL,
    "max_results" INTEGER NOT NULL,
    "key_rotated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "metasearch_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metasearch_landings" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "outcome" "MetasearchLandingOutcome" NOT NULL,
    "shown_minor" BIGINT NOT NULL,
    "landed_minor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metasearch_landings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metasearch_partners_code_key" ON "metasearch_partners"("code");

-- CreateIndex
CREATE UNIQUE INDEX "metasearch_partners_key_hash_key" ON "metasearch_partners"("key_hash");

-- CreateIndex
CREATE INDEX "metasearch_landings_partner_id_created_at_idx" ON "metasearch_landings"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "metasearch_landings_created_at_idx" ON "metasearch_landings"("created_at");

-- CreateIndex
CREATE INDEX "bookings_metasearch_landing_id_idx" ON "bookings"("metasearch_landing_id");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_metasearch_landing_id_fkey" FOREIGN KEY ("metasearch_landing_id") REFERENCES "metasearch_landings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_metasearch_landing_id_fkey" FOREIGN KEY ("metasearch_landing_id") REFERENCES "metasearch_landings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metasearch_landings" ADD CONSTRAINT "metasearch_landings_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "metasearch_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

