-- Fingerprint sign-in on a phone (ADR-067). Expand only: a new enum value and a new table; the
-- revision still serving never reads either.

-- Sessions started with a device credential.
ALTER TYPE "AuthMethod" ADD VALUE 'device';

-- One row per phone with fingerprint sign-in on: the HMAC of its secret, never the secret.
CREATE TABLE "device_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "device_credentials_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_credentials_user_id_idx" ON "device_credentials"("user_id");

ALTER TABLE "device_credentials" ADD CONSTRAINT "device_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
