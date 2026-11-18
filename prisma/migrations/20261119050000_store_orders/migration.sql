-- Loja: pedidos e itens do pedido. O estoque é reservado na criação e devolvido uma vez só (stock_released_at).

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "fulfillment_status" AS ENUM ('PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "delivery_method" AS ENUM ('PICKUP', 'SHIPPING', 'NONE');

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "customer_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "fulfillment_status" "fulfillment_status" NOT NULL DEFAULT 'PENDING',
    "delivery_method" "delivery_method" NOT NULL,
    "items_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "shipping_service_code" TEXT,
    "shipping_service_name" TEXT,
    "shipping_days" INTEGER,
    "tracking_code" TEXT,
    "ship_recipient" TEXT,
    "ship_postal_code" TEXT,
    "ship_street" TEXT,
    "ship_number" TEXT,
    "ship_complement" TEXT,
    "ship_district" TEXT,
    "ship_city" TEXT,
    "ship_state" TEXT,
    "customer_note" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by_type" "party_type",
    "canceled_by_id" UUID,
    "cancel_reason" TEXT,
    "stock_released_at" TIMESTAMPTZ(3),
    "attention" TEXT,
    "mp_preference_id" TEXT,
    "checkout_url" TEXT,
    "idempotency_key" TEXT,
    "idempotency_request_hash" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID,
    "name" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_id_key" ON "orders"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_number_key" ON "orders"("business_id", "number");

-- CreateIndex
CREATE INDEX "orders_business_id_status_expires_at_idx" ON "orders"("business_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "orders_business_id_customer_id_created_at_idx" ON "orders"("business_id", "customer_id", "created_at");

-- Chave de idempotência do pedido: única por cliente, só quando informada.
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("business_id", "customer_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "order_items_business_id_id_key" ON "order_items"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_order_id_position_key" ON "order_items"("order_id", "position");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- FKs compostas: cada relação fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_same_business_fkey"
  FOREIGN KEY ("business_id", "order_id") REFERENCES "orders"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_same_business_fkey"
  FOREIGN KEY ("business_id", "product_id") REFERENCES "products"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CheckConstraints: o dinheiro do pedido sempre fecha.
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_check" CHECK ("items_cents" >= 0 AND "shipping_cents" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_check" CHECK ("total_cents" = "items_cents" + "shipping_cents");
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_positive_check" CHECK ("total_cents" > 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_check" CHECK ("number" >= 1);
ALTER TABLE "orders" ADD CONSTRAINT "orders_canceled_check" CHECK (("status" = 'CANCELED') = ("canceled_at" IS NOT NULL));
ALTER TABLE "orders" ADD CONSTRAINT "orders_attention_check" CHECK ("attention" IS NULL OR "attention" IN ('amount_mismatch', 'stock_shortfall', 'payment_reversed'));
ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_code_check" CHECK ("tracking_code" IS NULL OR char_length("tracking_code") <= 40);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_unit_price_check" CHECK ("unit_price_cents" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_total_check" CHECK ("total_cents" = "unit_price_cents" * "quantity");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_position_check" CHECK ("position" >= 1);
-- Nesta fase todo item é um produto; a Tarefa 9 troca esta regra por "exatamente um entre produto e voucher".
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_one_target_check" CHECK ("product_id" IS NOT NULL);
