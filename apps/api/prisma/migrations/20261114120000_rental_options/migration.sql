-- Car rental options (ADR-098): airport branches, weekly and monthly rates, the minimum driver
-- age, extras, cross-border terms and returns to another branch. Expand-only: every column is
-- nullable or has a default, so the revision still serving keeps working.

ALTER TABLE "rental_vehicles"
  ADD COLUMN "airport_code" CHAR(3),
  ADD COLUMN "weekly_minor" BIGINT,
  ADD COLUMN "monthly_minor" BIGINT,
  ADD COLUMN "min_driver_age" INTEGER NOT NULL DEFAULT 21,
  ADD COLUMN "extras" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "cross_border" JSONB,
  ADD COLUMN "return_branches" JSONB NOT NULL DEFAULT '[]';

-- A weekly or monthly rate is a price, and a driver is an adult.
ALTER TABLE "rental_vehicles"
  ADD CONSTRAINT "rental_vehicles_weekly_minor_check" CHECK ("weekly_minor" IS NULL OR "weekly_minor" > 0),
  ADD CONSTRAINT "rental_vehicles_monthly_minor_check" CHECK ("monthly_minor" IS NULL OR "monthly_minor" > 0),
  ADD CONSTRAINT "rental_vehicles_min_driver_age_check" CHECK ("min_driver_age" BETWEEN 18 AND 99);

-- Airport branches are found by their code.
CREATE INDEX "rental_vehicles_airport_code_idx" ON "rental_vehicles" ("airport_code");
