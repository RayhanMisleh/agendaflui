CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "weekday" AS ENUM ('SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "appointment_source" AS ENUM ('APP', 'PANEL');

-- CreateEnum
CREATE TYPE "party_type" AS ENUM ('CUSTOMER', 'MEMBER', 'PLATFORM_ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "notification_kind" AS ENUM ('APPOINTMENT_CONFIRMED', 'APPOINTMENT_CANCELED', 'APPOINTMENT_RESCHEDULED', 'APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H', 'APPOINTMENT_COMPLETED', 'PROFESSIONAL_FREE_EARLY', 'STAFF_NEW_APPOINTMENT', 'STAFF_APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_RESCHEDULED');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "customer_origin" AS ENUM ('APP', 'PANEL');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "avatar_upload_id" UUID,
    "birth_date" DATE,
    "notes" TEXT,
    "is_club_member" BOOLEAN NOT NULL DEFAULT false,
    "notify_push_appointments" BOOLEAN NOT NULL DEFAULT true,
    "notify_email_appointments" BOOLEAN NOT NULL DEFAULT true,
    "notify_push_marketing" BOOLEAN NOT NULL DEFAULT true,
    "notify_email_marketing" BOOLEAN NOT NULL DEFAULT false,
    "origin" "customer_origin" NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professionals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "membership_id" UUID,
    "name" TEXT NOT NULL,
    "avatar_upload_id" UUID,
    "bio" TEXT,
    "commission_bps" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT NOT NULL DEFAULT 'sparkles',
    "price_cents" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "reward_points" INTEGER NOT NULL DEFAULT 0,
    "club_only" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professional_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "weekday" "weekday" NOT NULL,
    "start_min" INTEGER NOT NULL,
    "end_min" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_blocks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_by_type" "party_type" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_closures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "professional_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "appointment_status" NOT NULL,
    "source" "appointment_source" NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "total_duration_min" INTEGER NOT NULL,
    "commission_cents" INTEGER,
    "notes" TEXT,
    "created_by_type" "party_type" NOT NULL,
    "created_by_id" UUID,
    "canceled_at" TIMESTAMPTZ(3),
    "canceled_by_type" "party_type",
    "canceled_by_id" UUID,
    "cancel_reason" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "reward_points" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "kind" "notification_kind" NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "customer_id" UUID,
    "membership_id" UUID,
    "appointment_id" UUID,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "status" "notification_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_business_id_phone_idx" ON "customers"("business_id", "phone");

-- CreateIndex
CREATE INDEX "customers_business_id_name_idx" ON "customers"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "customers_business_id_id_key" ON "customers"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "professionals_business_id_id_key" ON "professionals"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "services_business_id_id_key" ON "services"("business_id", "id");

-- CreateIndex
CREATE INDEX "professional_services_service_id_idx" ON "professional_services"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_services_business_id_id_key" ON "professional_services"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_services_professional_id_service_id_key" ON "professional_services"("professional_id", "service_id");

-- CreateIndex
CREATE INDEX "working_hours_business_id_professional_id_weekday_idx" ON "working_hours"("business_id", "professional_id", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "working_hours_business_id_id_key" ON "working_hours"("business_id", "id");

-- CreateIndex
CREATE INDEX "time_blocks_business_id_professional_id_starts_at_idx" ON "time_blocks"("business_id", "professional_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "time_blocks_business_id_id_key" ON "time_blocks"("business_id", "id");

-- CreateIndex
CREATE INDEX "business_closures_business_id_start_date_idx" ON "business_closures"("business_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "business_closures_business_id_id_key" ON "business_closures"("business_id", "id");

-- CreateIndex
CREATE INDEX "appointments_business_id_starts_at_idx" ON "appointments"("business_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_professional_id_starts_at_idx" ON "appointments"("business_id", "professional_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_customer_id_starts_at_idx" ON "appointments"("business_id", "customer_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_business_id_id_key" ON "appointments"("business_id", "id");

-- CreateIndex
CREATE INDEX "appointment_items_service_id_idx" ON "appointment_items"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_items_business_id_id_key" ON "appointment_items"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_items_appointment_id_position_key" ON "appointment_items"("appointment_id", "position");

-- CreateIndex
CREATE INDEX "notifications_status_scheduled_for_idx" ON "notifications"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notifications_customer_id_idx" ON "notifications"("customer_id");

-- CreateIndex
CREATE INDEX "notifications_membership_id_idx" ON "notifications"("membership_id");

-- CreateIndex
CREATE INDEX "notifications_appointment_id_idx" ON "notifications"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_business_id_id_key" ON "notifications"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_business_id_dedupe_key_key" ON "notifications"("business_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_business_id_id_key" ON "memberships"("business_id", "id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_avatar_upload_id_fkey" FOREIGN KEY ("avatar_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_avatar_upload_id_fkey" FOREIGN KEY ("avatar_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_closures" ADD CONSTRAINT "business_closures_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_fkey" FOREIGN KEY ("professional_id") REFERENCES "professionals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FKs compostas: cada relação fica dentro da mesma conta. ON UPDATE NO ACTION, como nas migrações anteriores.
ALTER TABLE "customers" ADD CONSTRAINT "customers_avatar_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "avatar_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("avatar_upload_id") ON UPDATE NO ACTION;

ALTER TABLE "professionals" ADD CONSTRAINT "professionals_membership_id_same_business_fkey"
  FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id")
  ON DELETE SET NULL ("membership_id") ON UPDATE NO ACTION;

ALTER TABLE "professionals" ADD CONSTRAINT "professionals_avatar_upload_id_same_business_fkey"
  FOREIGN KEY ("business_id", "avatar_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("avatar_upload_id") ON UPDATE NO ACTION;

ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_same_business_fkey"
  FOREIGN KEY ("business_id", "professional_id") REFERENCES "professionals"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_service_id_same_business_fkey"
  FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_professional_id_same_business_fkey"
  FOREIGN KEY ("business_id", "professional_id") REFERENCES "professionals"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_professional_id_same_business_fkey"
  FOREIGN KEY ("business_id", "professional_id") REFERENCES "professionals"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_same_business_fkey"
  FOREIGN KEY ("business_id", "professional_id") REFERENCES "professionals"("business_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment_id_same_business_fkey"
  FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_service_id_same_business_fkey"
  FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_same_business_fkey"
  FOREIGN KEY ("business_id", "customer_id") REFERENCES "customers"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_membership_id_same_business_fkey"
  FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_appointment_id_same_business_fkey"
  FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

-- Índices parciais.
CREATE UNIQUE INDEX "customers_business_id_email_key" ON "customers"("business_id", "email") WHERE "email" IS NOT NULL;
CREATE UNIQUE INDEX "professionals_business_id_membership_id_key" ON "professionals"("business_id", "membership_id") WHERE "membership_id" IS NOT NULL;

-- Restrições de valores.
ALTER TABLE "customers" ADD CONSTRAINT "customers_email_normalized_check" CHECK ("email" IS NULL OR "email" = lower(btrim("email")));
ALTER TABLE "customers" ADD CONSTRAINT "customers_phone_format_check" CHECK ("phone" IS NULL OR "phone" ~ '^[0-9]{10,15}$');
ALTER TABLE "professionals" ADD CONSTRAINT "professionals_commission_bps_check" CHECK ("commission_bps" BETWEEN 0 AND 10000);
ALTER TABLE "services" ADD CONSTRAINT "services_price_cents_check" CHECK ("price_cents" >= 0);
ALTER TABLE "services" ADD CONSTRAINT "services_duration_min_check" CHECK ("duration_min" BETWEEN 5 AND 600 AND "duration_min" % 5 = 0);
ALTER TABLE "services" ADD CONSTRAINT "services_reward_points_check" CHECK ("reward_points" >= 0);
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_range_check" CHECK ("start_min" >= 0 AND "end_min" <= 1440 AND "start_min" < "end_min");
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_range_check" CHECK ("starts_at" < "ends_at");
ALTER TABLE "business_closures" ADD CONSTRAINT "business_closures_range_check" CHECK ("start_date" <= "end_date");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_range_check" CHECK ("starts_at" < "ends_at");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_totals_check" CHECK ("total_cents" >= 0 AND "total_duration_min" > 0);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_one_recipient_check" CHECK (("customer_id" IS NULL) <> ("membership_id" IS NULL));

-- Rede de segurança: o banco recusa dois agendamentos ativos sobrepostos do mesmo profissional.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist ("professional_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'COMPLETED'));
