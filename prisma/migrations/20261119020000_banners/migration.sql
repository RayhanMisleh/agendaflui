-- Banners: imagens com link e período que o app mostra na tela inicial.

-- CreateTable
CREATE TABLE "banners" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "image_upload_id" UUID,
    "link_url" TEXT,
    "starts_on" DATE,
    "ends_on" DATE,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "banners_business_id_id_key" ON "banners"("business_id", "id");

-- CreateIndex
CREATE INDEX "banners_business_id_display_order_idx" ON "banners"("business_id", "display_order");

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_image_upload_id_fkey" FOREIGN KEY ("image_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK composta: a imagem fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "banners" ADD CONSTRAINT "banners_image_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "image_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("image_upload_id") ON UPDATE NO ACTION;

-- CheckConstraints
ALTER TABLE "banners" ADD CONSTRAINT "banners_period_check" CHECK ("starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on");
ALTER TABLE "banners" ADD CONSTRAINT "banners_active_needs_image_check" CHECK ("active" = false OR "image_upload_id" IS NOT NULL);
