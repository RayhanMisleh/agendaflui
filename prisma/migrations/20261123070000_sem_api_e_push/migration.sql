-- O Agenda Flui passa a ser só web: saem a API do app (tokens de renovação), os aparelhos de push e as métricas de uso.
BEGIN;
DROP TABLE "api_usage_hourly";
DROP TABLE "refresh_tokens";
DROP TABLE "devices";
DROP TYPE "token_subject";
DROP TYPE "device_platform";
-- Sem push: as linhas de push saem e o canal fica só com e-mail.
DELETE FROM "notifications" WHERE "channel" = 'PUSH';
ALTER TYPE "notification_channel" RENAME TO "notification_channel_antigo";
CREATE TYPE "notification_channel" AS ENUM ('EMAIL');
ALTER TABLE "notifications" ALTER COLUMN "channel" TYPE "notification_channel" USING "channel"::text::"notification_channel";
DROP TYPE "notification_channel_antigo";
ALTER TABLE "customers" DROP COLUMN "notify_push_appointments", DROP COLUMN "notify_push_marketing";
-- O agendador não grava mais as métricas de uso.
DELETE FROM "scheduler_runs" WHERE "kind" = 'usage_flush';
ALTER TABLE "scheduler_runs" DROP CONSTRAINT "scheduler_runs_kind_check";
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_kind_check" CHECK ("kind" IN ('notifications', 'cleanup', 'store', 'retention'));
COMMIT;
