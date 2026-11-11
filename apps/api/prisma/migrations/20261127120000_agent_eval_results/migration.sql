-- Runs of the agent evals that staff recorded (ADR-106): which suite, against recorded answers
-- or a model, counts and case ids. Additive: a new table only.

-- CreateTable
CREATE TABLE "agent_eval_results" (
    "id" UUID NOT NULL,
    "suite" VARCHAR(20) NOT NULL,
    "mode" VARCHAR(20) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "cases" INTEGER NOT NULL,
    "held" INTEGER NOT NULL,
    "figures" JSONB NOT NULL,
    "failed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "models" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commit" VARCHAR(40),
    "ran_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_eval_results_ran_at_idx" ON "agent_eval_results"("ran_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_eval_results_suite_mode_ran_at_key" ON "agent_eval_results"("suite", "mode", "ran_at");
