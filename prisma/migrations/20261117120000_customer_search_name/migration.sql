-- AlterTable
ALTER TABLE "customers" ADD COLUMN "search_name" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "customers_business_id_search_name_idx" ON "customers"("business_id", "search_name");

-- Preenchimento inicial; o domínio grava a chave sem acentos no próximo salvamento.
UPDATE "customers" SET "search_name" = lower("name");
