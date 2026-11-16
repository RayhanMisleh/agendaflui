-- Uso da API por conta: a linha passa a ser única por (chave, conta, rota, hora) e a conta é obrigatória.
DELETE FROM "api_usage_hourly" WHERE "business_id" IS NULL;
DROP INDEX "api_usage_hourly_api_key_id_route_hour_key";
ALTER TABLE "api_usage_hourly" ALTER COLUMN "business_id" SET NOT NULL;
CREATE UNIQUE INDEX "api_usage_hourly_api_key_id_business_id_route_hour_key" ON "api_usage_hourly"("api_key_id", "business_id", "route", "hour");
ALTER TABLE "api_usage_hourly" ADD CONSTRAINT "api_usage_hourly_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
