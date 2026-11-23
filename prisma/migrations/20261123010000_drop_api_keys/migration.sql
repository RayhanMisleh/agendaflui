-- A API v1 serve só aos apps próprios: sai a chave de app. O uso por rota fica por conta, rota e hora.

-- Junta numa linha só o uso da mesma conta, rota e hora que veio por chaves diferentes (fica a linha de menor id).
UPDATE "api_usage_hourly" AS u
SET "count" = s."count", "error_count" = s."error_count", "total_ms" = s."total_ms", "max_ms" = s."max_ms", "updated_at" = CURRENT_TIMESTAMP
FROM (
  SELECT min("id"::text)::uuid AS "manter", sum("count")::int AS "count", sum("error_count")::int AS "error_count",
         sum("total_ms")::bigint AS "total_ms", max("max_ms") AS "max_ms"
  FROM "api_usage_hourly"
  GROUP BY "business_id", "route", "hour"
  HAVING count(*) > 1
) AS s
WHERE u."id" = s."manter";

DELETE FROM "api_usage_hourly" AS u
USING "api_usage_hourly" AS k
WHERE u."business_id" = k."business_id" AND u."route" = k."route" AND u."hour" = k."hour" AND k."id"::text < u."id"::text;

-- DropIndex
DROP INDEX "api_usage_hourly_api_key_id_business_id_route_hour_key";

-- DropForeignKey
ALTER TABLE "api_usage_hourly" DROP CONSTRAINT "api_usage_hourly_api_key_id_fkey";

-- AlterTable
ALTER TABLE "api_usage_hourly" DROP COLUMN "api_key_id";

-- CreateIndex
CREATE UNIQUE INDEX "api_usage_hourly_business_id_route_hour_key" ON "api_usage_hourly"("business_id", "route", "hour");

-- DropTable
DROP TABLE "api_keys";

-- DropEnum
DROP TYPE "api_key_kind";
