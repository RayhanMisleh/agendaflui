-- Loja: pagamentos do Mercado Pago. A situação do pagamento vem sempre da consulta à API do Mercado Pago.

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING', 'IN_PROCESS', 'APPROVED', 'REJECTED', 'CANCELED', 'REFUNDED', 'CHARGED_BACK');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL DEFAULT 'MERCADO_PAGO',
    "provider_payment_id" TEXT NOT NULL,
    "status" "payment_status" NOT NULL,
    "status_detail" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_business_id_id_key" ON "payments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_business_id_provider_provider_payment_id_key" ON "payments"("business_id", "provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK composta: o pagamento fica dentro da mesma conta do pedido. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_same_business_fkey"
  FOREIGN KEY ("business_id", "order_id") REFERENCES "orders"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_cents" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_check" CHECK (char_length("currency") BETWEEN 1 AND 10);

-- O agendador ganha a varredura da loja (tipo "store").
ALTER TABLE "scheduler_runs" DROP CONSTRAINT "scheduler_runs_kind_check";
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_kind_check" CHECK ("kind" IN ('notifications', 'cleanup', 'usage_flush', 'store'));
