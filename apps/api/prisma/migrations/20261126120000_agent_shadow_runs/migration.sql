-- How candidate prompts did on a turn they ran in the shadow of (ADR-106): codes and counts,
-- one row per run, gone with the run. Additive: a new table only.

-- CreateTable
CREATE TABLE "agent_shadow_runs" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "prompts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "live_agent" VARCHAR(32) NOT NULL,
    "agent" VARCHAR(32),
    "outcome" VARCHAR(40),
    "steps" INTEGER NOT NULL DEFAULT 0,
    "replayed" INTEGER NOT NULL DEFAULT 0,
    "missed" INTEGER NOT NULL DEFAULT 0,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micro_usd" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_shadow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_shadow_runs_run_id_key" ON "agent_shadow_runs"("run_id");

-- CreateIndex
CREATE INDEX "agent_shadow_runs_created_at_idx" ON "agent_shadow_runs"("created_at");

-- AddForeignKey
ALTER TABLE "agent_shadow_runs" ADD CONSTRAINT "agent_shadow_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
