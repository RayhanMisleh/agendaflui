-- Credenciais de integração por conta (Mercado Pago e Frenet), cifradas em repouso (AES-256-GCM no servidor).
-- Tabela de plataforma: sem acesso por `tenantDb`. Cifra e final de cada segredo ficam nulos juntos.

-- CreateTable
CREATE TABLE "business_integrations" (
    "business_id" UUID NOT NULL,
    "mp_access_token_enc" TEXT,
    "mp_access_token_last4" VARCHAR(4),
    "mp_webhook_secret_enc" TEXT,
    "mp_webhook_secret_last4" VARCHAR(4),
    "mp_webhook_key" TEXT,
    "mp_updated_at" TIMESTAMPTZ(3),
    "frenet_token_enc" TEXT,
    "frenet_token_last4" VARCHAR(4),
    "frenet_updated_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_integrations_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_integrations_mp_webhook_key_key" ON "business_integrations"("mp_webhook_key");

-- AddForeignKey
ALTER TABLE "business_integrations" ADD CONSTRAINT "business_integrations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CheckConstraints
ALTER TABLE "business_integrations" ADD CONSTRAINT "business_integrations_mp_access_token_check" CHECK (("mp_access_token_enc" IS NULL) = ("mp_access_token_last4" IS NULL));
ALTER TABLE "business_integrations" ADD CONSTRAINT "business_integrations_mp_webhook_secret_check" CHECK (("mp_webhook_secret_enc" IS NULL) = ("mp_webhook_secret_last4" IS NULL));
ALTER TABLE "business_integrations" ADD CONSTRAINT "business_integrations_frenet_token_check" CHECK (("frenet_token_enc" IS NULL) = ("frenet_token_last4" IS NULL));
