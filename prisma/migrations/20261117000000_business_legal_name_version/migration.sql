-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "legal_name" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "search_name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "users" ADD COLUMN "search_name" TEXT NOT NULL DEFAULT '';

-- Preenchimento inicial; o domínio grava a chave sem acentos no próximo salvamento.
UPDATE "businesses" SET "search_name" = lower("name");
UPDATE "users" SET "search_name" = lower("name");
