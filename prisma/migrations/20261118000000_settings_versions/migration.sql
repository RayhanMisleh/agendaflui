-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "business_modules" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
