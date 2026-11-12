-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android');

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "scope" TEXT NOT NULL,
    "user_id" UUID,
    "session_id" UUID,
    "booking_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "push_tokens_user_id_idx" ON "push_tokens"("user_id");

-- CreateIndex
CREATE INDEX "push_tokens_session_id_idx" ON "push_tokens"("session_id");

-- CreateIndex
CREATE INDEX "push_tokens_booking_id_idx" ON "push_tokens"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_hash_scope_key" ON "push_tokens"("token_hash", "scope");

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A token belongs to exactly one scope: an account session (with its user) or a booking (ADR-022).
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_one_scope" CHECK (
  ("session_id" IS NOT NULL AND "user_id" IS NOT NULL AND "booking_id" IS NULL AND "scope" = 'session:' || "session_id")
  OR ("booking_id" IS NOT NULL AND "session_id" IS NULL AND "user_id" IS NULL AND "scope" = 'booking:' || "booking_id")
);
