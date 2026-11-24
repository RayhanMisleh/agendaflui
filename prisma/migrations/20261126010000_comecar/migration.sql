-- Começo do dono: o progresso do passo a passo de /painel/comecar, uma linha por conta nova.
-- As contas que já existem ficam sem linha (já estão montadas): para elas não há começo.
BEGIN;

CREATE TYPE "onboarding_step" AS ENUM ('STORE', 'BRAND', 'ANIMALS', 'SERVICES', 'HOURS', 'TEAM', 'LINK');

CREATE TABLE "onboarding_progress" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "done_steps" "onboarding_step"[] NOT NULL DEFAULT ARRAY[]::"onboarding_step"[],
  "skipped_steps" "onboarding_step"[] NOT NULL DEFAULT ARRAY[]::"onboarding_step"[],
  "wizard_finished_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "dismissed_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "onboarding_progress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "onboarding_progress_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Um passo é feito ou pulado, nunca os dois.
  CONSTRAINT "onboarding_progress_steps_disjoint" CHECK (NOT ("done_steps" && "skipped_steps"))
);

CREATE UNIQUE INDEX "onboarding_progress_business_id_key" ON "onboarding_progress"("business_id");
CREATE UNIQUE INDEX "onboarding_progress_business_id_id_key" ON "onboarding_progress"("business_id", "id");

COMMIT;
