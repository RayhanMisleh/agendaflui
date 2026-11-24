-- Google Agenda (só enviar): a ligação de cada pessoa com a agenda dela e a fila de reconciliação dos agendamentos.
BEGIN;

CREATE TYPE "calendar_connection_status" AS ENUM ('CONNECTED', 'REVOKED');

-- Uma ligação por pessoa. O token de renovação fica selado (secret-box) e só existe enquanto a ligação está ativa.
CREATE TABLE "calendar_connections" (
  "user_id" UUID NOT NULL,
  "google_sub" TEXT NOT NULL,
  "status" "calendar_connection_status" NOT NULL,
  "refresh_token_enc" TEXT,
  "connected_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "last_synced_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "calendar_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- Ligada tem token; desligada não tem.
  CONSTRAINT "calendar_connections_token_by_status" CHECK (("status" = 'CONNECTED') = ("refresh_token_enc" IS NOT NULL)),
  CONSTRAINT "calendar_connections_revoked_at" CHECK (("status" = 'REVOKED') = ("revoked_at" IS NOT NULL))
);

-- Uma linha por agendamento: a geração sobe a cada mudança e o agendador deixa o Google igual ao estado atual.
CREATE TABLE "calendar_syncs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "appointment_id" UUID NOT NULL,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "synced_generation" INTEGER NOT NULL DEFAULT 0,
  "placed_user_id" UUID,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3),
  "locked_until" TIMESTAMPTZ(3),
  "locked_by" TEXT,
  "last_error" VARCHAR(40),
  "failed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "calendar_syncs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calendar_syncs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "calendar_syncs_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "calendar_syncs_placed_user_id_fkey" FOREIGN KEY ("placed_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "calendar_syncs_generation_check" CHECK ("synced_generation" >= 0 AND "synced_generation" <= "generation"),
  CONSTRAINT "calendar_syncs_attempts_check" CHECK ("attempts" BETWEEN 0 AND 6)
);

-- O agendamento é da mesma conta da linha (FK composta, como nas outras tabelas de conta).
ALTER TABLE "calendar_syncs" ADD CONSTRAINT "calendar_syncs_appointment_same_business_fkey"
  FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE UNIQUE INDEX "calendar_syncs_business_id_id_key" ON "calendar_syncs"("business_id", "id");
CREATE UNIQUE INDEX "calendar_syncs_business_id_appointment_id_key" ON "calendar_syncs"("business_id", "appointment_id");
CREATE UNIQUE INDEX "calendar_syncs_appointment_id_key" ON "calendar_syncs"("appointment_id");
CREATE INDEX "calendar_syncs_placed_user_id_idx" ON "calendar_syncs"("placed_user_id");
-- Só as linhas atrasadas e vivas entram no índice do agendador.
CREATE INDEX "calendar_syncs_due_idx" ON "calendar_syncs"("next_attempt_at") WHERE "generation" > "synced_generation" AND "failed_at" IS NULL;

-- Novo tipo de execução do agendador.
ALTER TABLE "scheduler_runs" DROP CONSTRAINT "scheduler_runs_kind_check";
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_kind_check" CHECK ("kind" IN ('notifications', 'cleanup', 'store', 'retention', 'calendar'));

COMMIT;
