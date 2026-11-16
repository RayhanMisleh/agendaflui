-- CreateIndex
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_created_at_idx" ON "appointments"("business_id", "created_at");

-- Índice parcial: só existe em SQL (o Prisma não descreve índice com WHERE). Receita das métricas olha só os COMPLETED.
CREATE INDEX "appointments_ends_at_completed_idx" ON "appointments"("ends_at") WHERE "status" = 'COMPLETED';

-- CreateIndex
CREATE INDEX "refresh_tokens_created_at_idx" ON "refresh_tokens"("created_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_used_at_idx" ON "refresh_tokens"("used_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "notifications_status_updated_at_idx" ON "notifications"("status", "updated_at");
