-- Feature parity, flights part 1. Both columns are nullable and unused by the revision still
-- serving, so the change is expand-only.

-- A special meal a flight passenger asks the airline for.
ALTER TABLE "booking_passengers" ADD COLUMN "meal_request" TEXT;

-- What a support conversation is about when it came from a form of its own (a group booking
-- request); null for conversations started on the support page.
ALTER TABLE "support_conversations" ADD COLUMN "topic" TEXT;
