-- Status page incidents and their public updates (ADR-087). Public text only, no personal data.
-- CreateEnum
CREATE TYPE "StatusIncidentImpact" AS ENUM ('minor', 'major');

-- CreateEnum
CREATE TYPE "StatusIncidentStage" AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');

-- CreateTable
CREATE TABLE "status_incidents" (
    "id" UUID NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "impact" "StatusIncidentImpact" NOT NULL,
    "status" "StatusIncidentStage" NOT NULL,
    "components" TEXT[],
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "status_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_incident_updates" (
    "id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "status" "StatusIncidentStage" NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "status_incidents_resolved_at_started_at_idx" ON "status_incidents"("resolved_at", "started_at");

-- CreateIndex
CREATE INDEX "status_incident_updates_incident_id_created_at_idx" ON "status_incident_updates"("incident_id", "created_at");

-- AddForeignKey
ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "status_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

