-- Cookie choices recorded before any optional category is enabled (ADR-042).
-- CreateTable
CREATE TABLE "cookie_consents" (
    "id" UUID NOT NULL,
    "consent_id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "analytics" BOOLEAN NOT NULL,
    "marketing" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cookie_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cookie_consents_consent_id_idx" ON "cookie_consents"("consent_id");

-- CreateIndex
CREATE INDEX "cookie_consents_created_at_idx" ON "cookie_consents"("created_at");

