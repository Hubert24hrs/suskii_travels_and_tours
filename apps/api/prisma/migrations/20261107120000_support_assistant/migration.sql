-- The after-hours support assistant (ADR-085): its author and handover kind, and the sources an
-- answer cited. Expand-only: new enum values and a nullable column.

-- AlterEnum
ALTER TYPE "SupportAuthor" ADD VALUE 'assistant';

-- AlterEnum
ALTER TYPE "SupportMessageKind" ADD VALUE 'handover';

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "assistant_sources" JSONB;

