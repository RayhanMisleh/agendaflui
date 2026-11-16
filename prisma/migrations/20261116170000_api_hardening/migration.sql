-- Lista vazia de origens é válida (nenhuma origem web); NULL nunca.
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_allowed_origins_not_null_check" CHECK ("allowed_origins" IS NOT NULL);

-- A hora do uso é conferida em UTC: a forma de dois argumentos depende do fuso da sessão.
ALTER TABLE "api_usage_hourly" DROP CONSTRAINT "api_usage_hourly_hour_check";
ALTER TABLE "api_usage_hourly" ADD CONSTRAINT "api_usage_hourly_hour_check" CHECK (date_trunc('hour', "hour", 'UTC') = "hour");

-- (status, scheduled_for) é prefixo de (status, scheduled_for, locked_until): o índice menor é redundante.
DROP INDEX "notifications_status_scheduled_for_idx";
