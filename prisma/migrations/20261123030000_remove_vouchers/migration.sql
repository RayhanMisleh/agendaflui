-- Remove vouchers: parceiros, vouchers, códigos, o módulo e a entrega "sem entrega" (só pedido de voucher usava).
-- Ordem pensada para bancos com dados: primeiro os pedidos de voucher, depois as tabelas.
-- O Prisma não envolve o arquivo numa transação: o BEGIN/COMMIT abaixo faz tudo valer ou nada.

BEGIN;

-- 1) Imagens que só parceiros e vouchers usavam (apagadas no fim, depois que nada mais as aponta).
CREATE TEMP TABLE "voucher_uploads" AS
  SELECT "logo_upload_id" AS "id" FROM "partners" WHERE "logo_upload_id" IS NOT NULL
  UNION
  SELECT "image_upload_id" FROM "vouchers" WHERE "image_upload_id" IS NOT NULL;

-- 2) Códigos vendidos (inclusive os já usados).
DELETE FROM "voucher_codes";

-- 3) Pedido em que todo item é voucher (ou sem entrega): some com os pagamentos e itens (ON DELETE CASCADE).
DELETE FROM "orders" o
WHERE o."delivery_method" = 'NONE'
   OR (
     EXISTS (SELECT 1 FROM "order_items" i WHERE i."order_id" = o."id")
     AND NOT EXISTS (SELECT 1 FROM "order_items" i WHERE i."order_id" = o."id" AND i."product_id" IS NOT NULL)
   );

-- 4) Pedido misto fica só com os produtos (os totais gravados do pedido não mudam).
DELETE FROM "order_items" WHERE "voucher_id" IS NOT NULL;

-- 5) O item do pedido volta a ser sempre de um produto.
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_one_target_check";
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_voucher_id_same_business_fkey";
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_voucher_id_fkey";
DROP INDEX "order_items_voucher_id_idx";
ALTER TABLE "order_items" DROP COLUMN "voucher_id";
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_one_target_check" CHECK ("product_id" IS NOT NULL);

-- 6) Tabelas e tipo.
DROP TABLE "voucher_codes";
DROP TABLE "vouchers";
DROP TABLE "partners";
DROP TYPE "voucher_code_status";

-- 7) O módulo.
ALTER TABLE "business_modules" DROP CONSTRAINT "business_modules_vouchers_need_store";
ALTER TABLE "business_modules" DROP COLUMN "vouchers";

-- 8) Imagens que ninguém mais usa (os arquivos no disco ficam).
DELETE FROM "uploads" u
WHERE u."id" IN (SELECT "id" FROM "voucher_uploads")
  AND NOT EXISTS (SELECT 1 FROM "business_branding" b WHERE u."id" IN (b."logo_upload_id", b."symbol_upload_id", b."favicon_upload_id", b."login_image_upload_id"))
  AND NOT EXISTS (SELECT 1 FROM "users" x WHERE x."avatar_upload_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "customers" x WHERE x."avatar_upload_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "professionals" x WHERE x."avatar_upload_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "prizes" x WHERE x."image_upload_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "banners" x WHERE x."image_upload_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "product_images" x WHERE x."upload_id" = u."id");

-- 9) Entrega "NONE" sai do tipo (nenhum pedido a usa mais).
ALTER TYPE "delivery_method" RENAME TO "delivery_method_old";
CREATE TYPE "delivery_method" AS ENUM ('PICKUP', 'SHIPPING');
ALTER TABLE "orders" ALTER COLUMN "delivery_method" TYPE "delivery_method" USING "delivery_method"::text::"delivery_method";
DROP TYPE "delivery_method_old";
DROP TABLE "voucher_uploads";

COMMIT;
