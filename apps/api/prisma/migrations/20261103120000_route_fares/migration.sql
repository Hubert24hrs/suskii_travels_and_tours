-- SEO pages from fare history (ADR-080). Expand only: a new table, nothing existing changes.

-- CreateTable
CREATE TABLE "route_fares" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "observed_on" DATE NOT NULL,
    "departure_date" DATE NOT NULL,
    "return_date" DATE,
    "supplier" TEXT NOT NULL,
    "carrier_code" VARCHAR(3) NOT NULL,
    "carrier_name" TEXT NOT NULL,
    "stops" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "base_minor" BIGINT NOT NULL,
    "taxes_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "usd_minor" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "route_fares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_fares_observed_on_idx" ON "route_fares"("observed_on");

-- CreateIndex
CREATE UNIQUE INDEX "route_fares_route_id_observed_on_departure_date_key" ON "route_fares"("route_id", "observed_on", "departure_date");

-- AddForeignKey
ALTER TABLE "route_fares" ADD CONSTRAINT "route_fares_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "deal_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
