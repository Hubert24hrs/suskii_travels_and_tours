-- Consented memory (ADR-105): the travel preferences the assistant may remember for a
-- traveller who agreed to it. A new table and a new nullable column; nothing existing changes.
-- AlterTable
ALTER TABLE "user_preferences" ADD COLUMN "assistant_memory_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "agent_memories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "key" VARCHAR(24) NOT NULL,
    "value" VARCHAR(40) NOT NULL,
    "source" VARCHAR(12) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_memories_user_id_key_key" ON "agent_memories"("user_id", "key");

-- AddForeignKey
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
