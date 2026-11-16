-- CreateEnum
CREATE TYPE "api_key_kind" AS ENUM ('ACCOUNT', 'PLATFORM');

-- CreateEnum
CREATE TYPE "token_subject" AS ENUM ('CUSTOMER', 'MEMBER');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "verification_purpose" AS ENUM ('REGISTER', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "skip_reason" TEXT;

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID,
    "kind" "api_key_kind" NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "subject" "token_subject" NOT NULL,
    "customer_id" UUID,
    "membership_id" UUID,
    "family_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID,
    "membership_id" UUID,
    "platform" "device_platform" NOT NULL,
    "push_token" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "purpose" "verification_purpose" NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "api_usage_hourly" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "api_key_id" UUID NOT NULL,
    "business_id" UUID,
    "route" TEXT NOT NULL,
    "hour" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "error_count" INTEGER NOT NULL,
    "total_ms" BIGINT NOT NULL,
    "max_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "api_usage_hourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_business_id_idx" ON "api_keys"("business_id");

-- CreateIndex
CREATE INDEX "api_keys_created_by_admin_id_idx" ON "api_keys"("created_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_business_id_family_id_idx" ON "refresh_tokens"("business_id", "family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_customer_id_idx" ON "refresh_tokens"("customer_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_membership_id_idx" ON "refresh_tokens"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_business_id_id_key" ON "refresh_tokens"("business_id", "id");

-- CreateIndex
CREATE INDEX "devices_customer_id_idx" ON "devices"("customer_id");

-- CreateIndex
CREATE INDEX "devices_membership_id_idx" ON "devices"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_business_id_id_key" ON "devices"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_business_id_push_token_key" ON "devices"("business_id", "push_token");

-- CreateIndex
CREATE INDEX "verification_codes_business_id_purpose_email_idx" ON "verification_codes"("business_id", "purpose", "email");

-- CreateIndex
CREATE UNIQUE INDEX "verification_codes_business_id_id_key" ON "verification_codes"("business_id", "id");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_window_start_idx" ON "rate_limit_buckets"("window_start");

-- CreateIndex
CREATE INDEX "api_usage_hourly_business_id_hour_idx" ON "api_usage_hourly"("business_id", "hour");

-- CreateIndex
CREATE UNIQUE INDEX "api_usage_hourly_api_key_id_route_hour_key" ON "api_usage_hourly"("api_key_id", "route", "hour");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_locked_until_idx" ON "notifications"("status", "scheduled_for", "locked_until");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_hourly" ADD CONSTRAINT "api_usage_hourly_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- FKs compostas: cada relação fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_membership_id_same_business_fkey"
  FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "devices" ADD CONSTRAINT "devices_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "devices" ADD CONSTRAINT "devices_membership_id_same_business_fkey"
  FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- Restrições de valores.
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_kind_business_check" CHECK (("kind" = 'ACCOUNT') = ("business_id" IS NOT NULL));
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_prefix_format_check" CHECK ("prefix" ~ '^[0-9a-f]{8}$');
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_subject_owner_check" CHECK (
  ("subject" = 'CUSTOMER' AND "customer_id" IS NOT NULL AND "membership_id" IS NULL)
  OR ("subject" = 'MEMBER' AND "membership_id" IS NOT NULL AND "customer_id" IS NULL)
);
ALTER TABLE "devices" ADD CONSTRAINT "devices_one_owner_check" CHECK (("customer_id" IS NULL) <> ("membership_id" IS NULL));
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_email_normalized_check" CHECK ("email" = lower(btrim("email")));
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_attempts_check" CHECK ("attempts" >= 0);
ALTER TABLE "rate_limit_buckets" ADD CONSTRAINT "rate_limit_buckets_count_check" CHECK ("count" >= 0);
ALTER TABLE "api_usage_hourly" ADD CONSTRAINT "api_usage_hourly_counters_check" CHECK ("count" >= 0 AND "error_count" >= 0 AND "total_ms" >= 0 AND "max_ms" >= 0);
ALTER TABLE "api_usage_hourly" ADD CONSTRAINT "api_usage_hourly_hour_check" CHECK ("hour" = date_trunc('hour', "hour"));
