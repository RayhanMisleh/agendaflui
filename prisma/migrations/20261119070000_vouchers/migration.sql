-- Vouchers: parceiros, vouchers à venda e códigos únicos por unidade vendida.

-- CreateEnum
CREATE TYPE "voucher_code_status" AS ENUM ('ACTIVE', 'REDEEMED', 'VOID');

-- CreateTable
CREATE TABLE "partners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "logo_upload_id" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT,
    "image_upload_id" UUID,
    "price_cents" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "valid_days" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "voucher_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "status" "voucher_code_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3),
    "redeemed_at" TIMESTAMPTZ(3),
    "redeemed_by_type" "party_type",
    "redeemed_by_id" UUID,
    "redeemed_by_name" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "voucher_codes_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "voucher_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "partners_business_id_id_key" ON "partners"("business_id", "id");
CREATE INDEX "partners_business_id_idx" ON "partners"("business_id");
CREATE UNIQUE INDEX "vouchers_business_id_id_key" ON "vouchers"("business_id", "id");
CREATE INDEX "vouchers_business_id_display_order_idx" ON "vouchers"("business_id", "display_order");
CREATE INDEX "vouchers_partner_id_idx" ON "vouchers"("partner_id");
CREATE UNIQUE INDEX "voucher_codes_business_id_id_key" ON "voucher_codes"("business_id", "id");
CREATE UNIQUE INDEX "voucher_codes_business_id_code_key" ON "voucher_codes"("business_id", "code");
CREATE UNIQUE INDEX "voucher_codes_order_item_id_seq_key" ON "voucher_codes"("order_item_id", "seq");
CREATE INDEX "voucher_codes_business_id_customer_id_idx" ON "voucher_codes"("business_id", "customer_id");
CREATE INDEX "voucher_codes_business_id_status_idx" ON "voucher_codes"("business_id", "status");
CREATE INDEX "voucher_codes_order_id_idx" ON "voucher_codes"("order_id");
CREATE INDEX "voucher_codes_voucher_id_idx" ON "voucher_codes"("voucher_id");
CREATE INDEX "order_items_voucher_id_idx" ON "order_items"("voucher_id");

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "partners" ADD CONSTRAINT "partners_logo_upload_id_fkey" FOREIGN KEY ("logo_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_image_upload_id_fkey" FOREIGN KEY ("image_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- FKs compostas: cada relação fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "partners" ADD CONSTRAINT "partners_logo_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "logo_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_partner_id_same_business_fkey"
  FOREIGN KEY ("business_id", "partner_id") REFERENCES "partners"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_image_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "image_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "order_items" ADD CONSTRAINT "order_items_voucher_id_same_business_fkey"
  FOREIGN KEY ("business_id", "voucher_id") REFERENCES "vouchers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_voucher_id_same_business_fkey"
  FOREIGN KEY ("business_id", "voucher_id") REFERENCES "vouchers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_order_id_same_business_fkey"
  FOREIGN KEY ("business_id", "order_id") REFERENCES "orders"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_order_item_id_same_business_fkey"
  FOREIGN KEY ("business_id", "order_item_id") REFERENCES "order_items"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_price_check" CHECK ("price_cents" > 0);
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_stock_check" CHECK ("stock" >= 0);
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_valid_days_check" CHECK ("valid_days" IS NULL OR "valid_days" BETWEEN 1 AND 730);
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_seq_check" CHECK ("seq" >= 1);
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_redeemed_check" CHECK (("status" = 'REDEEMED') = ("redeemed_at" IS NOT NULL));
ALTER TABLE "voucher_codes" ADD CONSTRAINT "voucher_codes_void_check" CHECK (("status" = 'VOID') = ("voided_at" IS NOT NULL));

-- O item do pedido é de um produto OU de um voucher (a Tarefa 6 exigia produto).
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_one_target_check";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_one_target_check" CHECK (("product_id" IS NOT NULL) <> ("voucher_id" IS NOT NULL));
