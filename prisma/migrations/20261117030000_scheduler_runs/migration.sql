-- CreateTable
CREATE TABLE "scheduler_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "ok" BOOLEAN NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduler_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "scheduler_runs_kind_check" CHECK ("kind" IN ('notifications', 'cleanup', 'usage_flush'))
);

-- CreateIndex
CREATE INDEX "scheduler_runs_kind_started_at_idx" ON "scheduler_runs"("kind", "started_at");

-- CreateIndex
CREATE INDEX "scheduler_runs_started_at_idx" ON "scheduler_runs"("started_at");
