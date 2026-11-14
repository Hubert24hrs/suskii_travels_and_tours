-- Parts Ask Suskii prepared for a combined trip (ADR-117): quotes waiting for the travellers'
-- details, shown on the trip page with their price. Additive: a new column with a default, so
-- the revision still serving keeps working and every trip that exists has nothing prepared.

-- AlterTable
ALTER TABLE "trips" ADD COLUMN "prepared" JSONB NOT NULL DEFAULT '[]';
