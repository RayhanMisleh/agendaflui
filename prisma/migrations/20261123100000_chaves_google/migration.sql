-- Configurações da plataforma (uma linha só): por enquanto, as chaves do "Entrar com Google".
-- O segredo fica selado (secret-box, AAD platform:google:client_secret); a tela mostra só os 4 últimos.
BEGIN;
CREATE TABLE "platform_settings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "google_client_id" TEXT,
  "google_client_secret_enc" TEXT,
  "google_client_secret_last4" VARCHAR(4),
  "google_updated_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "platform_settings_single_row" CHECK ("id" = 1),
  CONSTRAINT "platform_settings_google_together" CHECK (
    ("google_client_id" IS NULL) = ("google_client_secret_enc" IS NULL)
    AND ("google_client_secret_enc" IS NULL) = ("google_client_secret_last4" IS NULL))
);
INSERT INTO "platform_settings" ("id", "updated_at") VALUES (1, CURRENT_TIMESTAMP);
COMMIT;
