-- Fidelidade: razão de pontos, prêmios e resgates. O saldo do cliente é a soma de loyalty_transactions.

-- CreateEnum
CREATE TYPE "loyalty_entry_kind" AS ENUM ('EARN', 'EARN_REVERSAL', 'REDEEM', 'REDEEM_REVERSAL', 'ADJUST');

-- CreateEnum
CREATE TYPE "redemption_status" AS ENUM ('PENDING', 'DELIVERED', 'CANCELED');

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "kind" "loyalty_entry_kind" NOT NULL,
    "points" INTEGER NOT NULL,
    "appointment_id" UUID,
    "redemption_id" UUID,
    "reason" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "created_by_type" "party_type" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prizes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "image_upload_id" UUID,
    "cost_points" INTEGER NOT NULL,
    "stock" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prize_redemptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "prize_id" UUID NOT NULL,
    "prize_name" TEXT NOT NULL,
    "cost_points" INTEGER NOT NULL,
    "status" "redemption_status" NOT NULL DEFAULT 'PENDING',
    "requested_by_type" "party_type" NOT NULL,
    "requested_by_id" UUID,
    "delivered_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "idempotency_key" TEXT,
    "idempotency_request_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "prize_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_business_id_id_key" ON "loyalty_transactions"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_transactions_business_id_dedupe_key_key" ON "loyalty_transactions"("business_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "loyalty_transactions_business_id_customer_id_created_at_idx" ON "loyalty_transactions"("business_id", "customer_id", "created_at");

-- CreateIndex
CREATE INDEX "loyalty_transactions_appointment_id_idx" ON "loyalty_transactions"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "prizes_business_id_id_key" ON "prizes"("business_id", "id");

-- CreateIndex
CREATE INDEX "prizes_business_id_display_order_idx" ON "prizes"("business_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "prize_redemptions_business_id_id_key" ON "prize_redemptions"("business_id", "id");

-- CreateIndex
CREATE INDEX "prize_redemptions_business_id_status_created_at_idx" ON "prize_redemptions"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "prize_redemptions_business_id_customer_id_created_at_idx" ON "prize_redemptions"("business_id", "customer_id", "created_at");

-- Chave de idempotência do resgate: única por cliente, só quando informada.
CREATE UNIQUE INDEX "prize_redemptions_idempotency_key_key" ON "prize_redemptions"("business_id", "customer_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "prize_redemptions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_image_upload_id_fkey" FOREIGN KEY ("image_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_prize_id_fkey" FOREIGN KEY ("prize_id") REFERENCES "prizes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- FKs compostas: cada relação fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_appointment_id_same_business_fkey"
  FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_redemption_id_same_business_fkey"
  FOREIGN KEY ("business_id", "redemption_id") REFERENCES "prize_redemptions"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "prizes" ADD CONSTRAINT "prizes_image_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "image_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("image_upload_id") ON UPDATE NO ACTION;

ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_prize_id_same_business_fkey"
  FOREIGN KEY ("business_id", "prize_id") REFERENCES "prizes"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_points_check" CHECK ("points" <> 0);
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_sign_check" CHECK (
  ("kind" IN ('EARN', 'REDEEM_REVERSAL') AND "points" > 0)
  OR ("kind" IN ('EARN_REVERSAL', 'REDEEM') AND "points" < 0)
  OR "kind" = 'ADJUST'
);
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_adjust_reason_check" CHECK ("kind" <> 'ADJUST' OR ("reason" IS NOT NULL AND btrim("reason") <> ''));
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_cost_points_check" CHECK ("cost_points" > 0);
ALTER TABLE "prizes" ADD CONSTRAINT "prizes_stock_check" CHECK ("stock" IS NULL OR "stock" >= 0);
ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_cost_points_check" CHECK ("cost_points" > 0);
ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_delivered_check" CHECK (("status" = 'DELIVERED') = ("delivered_at" IS NOT NULL));
ALTER TABLE "prize_redemptions" ADD CONSTRAINT "prize_redemptions_canceled_check" CHECK (("status" = 'CANCELED') = ("canceled_at" IS NOT NULL));
