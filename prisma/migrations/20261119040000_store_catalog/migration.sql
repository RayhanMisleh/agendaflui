-- Loja: configurações, categorias, produtos, imagens e endereços do cliente.

-- CreateTable
CREATE TABLE "store_settings" (
    "business_id" UUID NOT NULL,
    "pickup_enabled" BOOLEAN NOT NULL DEFAULT true,
    "pickup_instructions" TEXT,
    "shipping_enabled" BOOLEAN NOT NULL DEFAULT false,
    "origin_postal_code" TEXT,
    "default_weight_grams" INTEGER NOT NULL DEFAULT 1000,
    "default_length_cm" INTEGER NOT NULL DEFAULT 20,
    "default_height_cm" INTEGER NOT NULL DEFAULT 10,
    "default_width_cm" INTEGER NOT NULL DEFAULT 30,
    "payment_window_min" INTEGER NOT NULL DEFAULT 60,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "category_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "promo_price_cents" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "weight_grams" INTEGER,
    "length_cm" INTEGER,
    "height_cm" INTEGER,
    "width_cm" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "district" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_business_id_id_key" ON "product_categories"("business_id", "id");

-- CreateIndex
CREATE INDEX "product_categories_business_id_display_order_idx" ON "product_categories"("business_id", "display_order");

-- Nome único na conta entre as categorias não arquivadas, sem contar acento, caixa nem espaço repetido (name_key).
CREATE UNIQUE INDEX "product_categories_name_key_active_key" ON "product_categories"("business_id", "name_key") WHERE "archived_at" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "products_business_id_id_key" ON "products"("business_id", "id");

-- CreateIndex
CREATE INDEX "products_business_id_display_order_idx" ON "products"("business_id", "display_order");

-- CreateIndex
CREATE INDEX "products_business_id_category_id_idx" ON "products"("business_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_business_id_id_key" ON "product_images"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_product_id_position_key" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_images_upload_id_idx" ON "product_images"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_business_id_id_key" ON "addresses"("business_id", "id");

-- CreateIndex
CREATE INDEX "addresses_business_id_customer_id_idx" ON "addresses"("business_id", "customer_id");

-- Um endereço padrão só por cliente.
CREATE UNIQUE INDEX "addresses_default_key" ON "addresses"("customer_id") WHERE "is_default";

-- AddForeignKey
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "uploads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- FKs compostas: cada relação fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_same_business_fkey"
  FOREIGN KEY ("business_id", "category_id") REFERENCES "product_categories"("business_id", "id")
  ON DELETE SET NULL ("category_id") ON UPDATE NO ACTION;

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_same_business_fkey"
  FOREIGN KEY ("business_id", "product_id") REFERENCES "products"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "product_images" ADD CONSTRAINT "product_images_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_one_way_check" CHECK ("pickup_enabled" OR "shipping_enabled");
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_payment_window_check" CHECK ("payment_window_min" BETWEEN 15 AND 1440);
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_origin_check" CHECK ("origin_postal_code" IS NULL OR "origin_postal_code" ~ '^[0-9]{8}$');
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_package_check" CHECK (
  "default_weight_grams" BETWEEN 1 AND 30000 AND "default_length_cm" BETWEEN 1 AND 200
  AND "default_height_cm" BETWEEN 1 AND 200 AND "default_width_cm" BETWEEN 1 AND 200
);
ALTER TABLE "products" ADD CONSTRAINT "products_price_check" CHECK ("price_cents" > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_promo_check" CHECK ("promo_price_cents" IS NULL OR ("promo_price_cents" > 0 AND "promo_price_cents" < "price_cents"));
ALTER TABLE "products" ADD CONSTRAINT "products_stock_check" CHECK ("stock" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_dimensions_check" CHECK (
  ("weight_grams" IS NULL OR "weight_grams" BETWEEN 1 AND 30000)
  AND ("length_cm" IS NULL OR "length_cm" BETWEEN 1 AND 200)
  AND ("height_cm" IS NULL OR "height_cm" BETWEEN 1 AND 200)
  AND ("width_cm" IS NULL OR "width_cm" BETWEEN 1 AND 200)
);
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_postal_code_check" CHECK ("postal_code" ~ '^[0-9]{8}$');
