-- A limpeza de retenção filtra só por `hour`; nenhum índice existente começa por ela.
CREATE INDEX "api_usage_hourly_hour_idx" ON "api_usage_hourly"("hour");
