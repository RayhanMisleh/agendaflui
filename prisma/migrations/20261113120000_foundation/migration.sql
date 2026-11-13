-- CreateEnum
CREATE TYPE "business_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('OWNER', 'MANAGER', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "cover_material" AS ENUM ('LEATHER', 'LINEN', 'WOOD', 'ENAMEL');

-- CreateEnum
CREATE TYPE "paper_tone" AS ENUM ('WHITE', 'CREAM', 'GRAY');

-- CreateEnum
CREATE TYPE "font_pair" AS ENUM ('CLASSIC', 'MODERN', 'FRIENDLY');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('PLATFORM_ADMIN', 'USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "user_token_purpose" AS ENUM ('INVITE', 'PASSWORD_RESET');

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segment" TEXT,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "status" "business_status" NOT NULL DEFAULT 'ACTIVE',
    "internal_notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_branding" (
    "business_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "logo_upload_id" UUID,
    "symbol_upload_id" UUID,
    "favicon_upload_id" UUID,
    "login_image_upload_id" UUID,
    "login_message" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#0E4F5C',
    "accent_color" TEXT NOT NULL DEFAULT '#E0A030',
    "cover_material" "cover_material" NOT NULL DEFAULT 'ENAMEL',
    "paper_tone" "paper_tone" NOT NULL DEFAULT 'WHITE',
    "font_pair" "font_pair" NOT NULL DEFAULT 'CLASSIC',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_branding_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "business_modules" (
    "business_id" UUID NOT NULL,
    "loyalty" BOOLEAN NOT NULL DEFAULT false,
    "banners" BOOLEAN NOT NULL DEFAULT false,
    "store" BOOLEAN NOT NULL DEFAULT false,
    "vouchers" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_modules_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "business_id" UUID NOT NULL,
    "slot_step_min" INTEGER NOT NULL DEFAULT 15,
    "min_lead_min" INTEGER NOT NULL DEFAULT 60,
    "max_advance_days" INTEGER NOT NULL DEFAULT 60,
    "customer_change_window_min" INTEGER NOT NULL DEFAULT 120,
    "buffer_min" INTEGER NOT NULL DEFAULT 0,
    "auto_confirm" BOOLEAN NOT NULL DEFAULT true,
    "term_professional_singular" TEXT NOT NULL DEFAULT 'Profissional',
    "term_professional_plural" TEXT NOT NULL DEFAULT 'Profissionais',
    "term_customer_singular" TEXT NOT NULL DEFAULT 'Cliente',
    "term_customer_plural" TEXT NOT NULL DEFAULT 'Clientes',
    "term_points_singular" TEXT NOT NULL DEFAULT 'Ponto',
    "term_points_plural" TEXT NOT NULL DEFAULT 'Pontos',
    "term_club" TEXT NOT NULL DEFAULT 'Clube',
    "loyalty_ranking_enabled" BOOLEAN NOT NULL DEFAULT false,
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "avatar_upload_id" UUID,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "impersonator_admin_id" UUID,
    "active_business_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "purpose" "user_token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID,
    "path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_by_type" "audit_actor_type" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_id" UUID,
    "actor_name" TEXT NOT NULL,
    "on_behalf" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_email_key" ON "platform_admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sessions_token_hash_key" ON "platform_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "platform_sessions_admin_id_idx" ON "platform_sessions"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_business_id_user_id_key" ON "memberships"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_impersonator_admin_id_idx" ON "sessions"("impersonator_admin_id");

-- CreateIndex
CREATE INDEX "sessions_active_business_id_idx" ON "sessions"("active_business_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tokens_token_hash_key" ON "user_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "user_tokens_user_id_idx" ON "user_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_path_key" ON "uploads"("path");

-- CreateIndex
CREATE INDEX "uploads_business_id_idx" ON "uploads"("business_id");

-- CreateIndex
CREATE INDEX "audit_logs_business_id_created_at_idx" ON "audit_logs"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "platform_sessions" ADD CONSTRAINT "platform_sessions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_logo_upload_id_fkey" FOREIGN KEY ("logo_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_symbol_upload_id_fkey" FOREIGN KEY ("symbol_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_favicon_upload_id_fkey" FOREIGN KEY ("favicon_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_login_image_upload_id_fkey" FOREIGN KEY ("login_image_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_modules" ADD CONSTRAINT "business_modules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_upload_id_fkey" FOREIGN KEY ("avatar_upload_id") REFERENCES "uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_impersonator_admin_id_fkey" FOREIGN KEY ("impersonator_admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_business_id_fkey" FOREIGN KEY ("active_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restrições que o Prisma não expressa.
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "businesses_slug_length" CHECK (char_length("slug") BETWEEN 3 AND 40);

ALTER TABLE "business_modules"
  ADD CONSTRAINT "business_modules_vouchers_need_store" CHECK (NOT "vouchers" OR "store");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_exactly_one_owner" CHECK (("user_id" IS NULL) <> ("impersonator_admin_id" IS NULL));

ALTER TABLE "business_branding"
  ADD CONSTRAINT "business_branding_primary_color_format" CHECK ("primary_color" ~ '^#[0-9A-F]{6}$'),
  ADD CONSTRAINT "business_branding_accent_color_format" CHECK ("accent_color" ~ '^#[0-9A-F]{6}$');

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email")));

ALTER TABLE "platform_admins"
  ADD CONSTRAINT "platform_admins_email_normalized" CHECK ("email" = lower(btrim("email")));
