-- Preço e tempo por animal e porte: modo de preço do serviço e linhas por variante.
BEGIN;

CREATE TYPE "pricing_mode" AS ENUM ('SINGLE', 'BY_VARIANT');

-- Serviços existentes continuam com preço único.
ALTER TABLE "services" ADD COLUMN "pricing_mode" "pricing_mode" NOT NULL DEFAULT 'SINGLE';

CREATE TABLE "service_prices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "variant" "price_variant" NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_prices_business_id_id_key" ON "service_prices"("business_id", "id");
CREATE UNIQUE INDEX "service_prices_service_id_variant_key" ON "service_prices"("service_id", "variant");

ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK composta: o serviço fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_service_id_same_business_fkey"
  FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_price_cents_check"
  CHECK ("price_cents" BETWEEN 0 AND 10000000);
ALTER TABLE "service_prices" ADD CONSTRAINT "service_prices_duration_min_check"
  CHECK ("duration_min" BETWEEN 5 AND 600 AND "duration_min" % 5 = 0);

COMMIT;
