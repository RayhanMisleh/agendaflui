-- Nicho da conta (pet shop), opções do nicho e pets do cliente.
BEGIN;

CREATE TYPE "niche" AS ENUM ('PET');
CREATE TYPE "pet_species" AS ENUM ('DOG', 'CAT');
CREATE TYPE "pet_size" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'GIANT');
CREATE TYPE "pet_coat" AS ENUM ('SHORT', 'MEDIUM', 'LONG');
CREATE TYPE "price_variant" AS ENUM ('DOG_SMALL', 'DOG_MEDIUM', 'DOG_LARGE', 'DOG_GIANT', 'CAT');

-- Nicho da conta: nulo = conta sem nicho (agenda genérica). Produção só tem a `demo`, que é pet shop.
ALTER TABLE "businesses" ADD COLUMN "niche" "niche";
UPDATE "businesses" SET "niche" = 'PET';

-- Opções do nicho (JSON validado pelo esquema do nicho no código).
ALTER TABLE "business_settings" ADD COLUMN "niche_options" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_niche_options_check"
  CHECK (jsonb_typeof("niche_options") = 'object');

-- Pets do cliente.
CREATE TABLE "pets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "search_name" TEXT NOT NULL DEFAULT '',
    "species" "pet_species" NOT NULL,
    "size" "pet_size",
    "breed" TEXT,
    "birth_month" DATE,
    "coat" "pet_coat",
    "care_notes" TEXT,
    "photo_upload_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pets_business_id_id_key" ON "pets"("business_id", "id");
CREATE UNIQUE INDEX "pets_business_id_customer_id_id_key" ON "pets"("business_id", "customer_id", "id");
CREATE INDEX "pets_business_id_customer_id_idx" ON "pets"("business_id", "customer_id");
CREATE INDEX "pets_business_id_search_name_idx" ON "pets"("business_id", "search_name");

ALTER TABLE "pets" ADD CONSTRAINT "pets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pets" ADD CONSTRAINT "pets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "pets" ADD CONSTRAINT "pets_photo_upload_id_fkey" FOREIGN KEY ("photo_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FKs compostas: o cliente e a foto ficam dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "pets" ADD CONSTRAINT "pets_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "pets" ADD CONSTRAINT "pets_photo_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "photo_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("photo_upload_id") ON UPDATE NO ACTION;

-- Cão tem porte; gato não tem.
ALTER TABLE "pets" ADD CONSTRAINT "pets_size_by_species_check"
  CHECK (("species" = 'DOG' AND "size" IS NOT NULL) OR ("species" = 'CAT' AND "size" IS NULL));
ALTER TABLE "pets" ADD CONSTRAINT "pets_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 40);
ALTER TABLE "pets" ADD CONSTRAINT "pets_breed_check" CHECK ("breed" IS NULL OR char_length("breed") <= 60);
ALTER TABLE "pets" ADD CONSTRAINT "pets_care_notes_check" CHECK ("care_notes" IS NULL OR char_length("care_notes") <= 1000);
-- Mês de nascimento é sempre o dia 1.
ALTER TABLE "pets" ADD CONSTRAINT "pets_birth_month_check" CHECK ("birth_month" IS NULL OR extract(day FROM "birth_month") = 1);

COMMIT;
