-- Chave de idempotência do pedido de marcação feito pelo app: repetir o pedido com a mesma chave devolve o mesmo agendamento.
ALTER TABLE "appointments" ADD COLUMN "idempotency_key" TEXT;
ALTER TABLE "appointments" ADD COLUMN "idempotency_key_at" TIMESTAMPTZ(3);

-- Uma chave por cliente (e conta); agendamentos sem chave não entram no índice.
CREATE UNIQUE INDEX "appointments_idempotency_key_key" ON "appointments"("business_id", "customer_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
