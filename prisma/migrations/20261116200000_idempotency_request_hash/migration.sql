-- Impressão (SHA-256) do pedido que usou a chave de idempotência: a repetição compara com o pedido original, não com o estado atual.
ALTER TABLE "appointments" ADD COLUMN "idempotency_request_hash" TEXT;
