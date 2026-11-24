-- Pessoa única: o usuário (`users`) vira a pessoa da plataforma, com senha e/ou Google, e o cliente de cada loja passa a apontar para ela.
-- Os códigos de e-mail (cadastro e troca de e-mail) viram tabela de plataforma e a sessão guarda a última loja usada.
BEGIN;

-- 1. A pessoa ganha telefone, verificação do e-mail e o Google (identidade fixa `sub`).
ALTER TABLE "users"
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "google_sub" TEXT,
  ADD COLUMN "google_email" TEXT,
  ADD COLUMN "google_linked_at" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");
-- Google vem inteiro ou não vem: identidade, e-mail do Google e instante do vínculo.
ALTER TABLE "users" ADD CONSTRAINT "users_google_together"
  CHECK (("google_sub" IS NULL) = ("google_email" IS NULL) AND ("google_sub" IS NULL) = ("google_linked_at" IS NULL));

-- 2. A equipe que já criou senha tem o e-mail provado pelo convite.
UPDATE "users" SET "email_verified_at" = "updated_at" WHERE "password_hash" IS NOT NULL;

-- 3. O cliente da loja aponta para a pessoa (nulo = cliente de balcão, sem conta).
ALTER TABLE "customers" ADD COLUMN "user_id" UUID, ADD COLUMN "linked_at" TIMESTAMPTZ(3);

-- 4. Clientes com senha viram pessoas (ou se ligam à pessoa que já tem o mesmo e-mail).
DO $$
DECLARE
  c RECORD;
  p RECORD;
  alvo UUID;
  criadas INTEGER := 0;
  ligadas INTEGER := 0;
  ativadas INTEGER := 0;
  descartadas INTEGER := 0;
BEGIN
  FOR c IN SELECT * FROM "customers" WHERE "password_hash" IS NOT NULL ORDER BY "created_at", "id" LOOP
    IF c."email" IS NULL THEN
      RAISE EXCEPTION 'Cliente % (loja %) tem senha mas não tem e-mail; corrija antes de migrar.', c."id", c."business_id";
    END IF;
    SELECT * INTO p FROM "users" WHERE "email" = c."email";
    IF NOT FOUND THEN
      INSERT INTO "users" ("name", "search_name", "email", "phone", "password_hash", "email_verified_at", "updated_at")
      VALUES (c."name", c."search_name", c."email", c."phone", c."password_hash", coalesce(c."email_verified_at", now()), now())
      RETURNING "id" INTO alvo;
      criadas := criadas + 1;
    ELSIF p."password_hash" IS NULL AND p."google_sub" IS NULL THEN
      -- Pessoa pendente (convite não aceito): recebe a senha e a verificação do cliente, senão ficaria trancada.
      UPDATE "users" SET "password_hash" = c."password_hash", "email_verified_at" = coalesce(p."email_verified_at", c."email_verified_at", now()),
        "phone" = coalesce(p."phone", c."phone"), "updated_at" = now() WHERE "id" = p."id";
      alvo := p."id";
      ativadas := ativadas + 1;
    ELSE
      alvo := p."id";
      descartadas := descartadas + 1;
      RAISE NOTICE 'Cliente % ligado à pessoa % já existente; a senha do cliente foi descartada.', c."id", p."id";
    END IF;
    UPDATE "customers" SET "user_id" = alvo, "linked_at" = now() WHERE "id" = c."id";
    ligadas := ligadas + 1;
  END LOOP;
  RAISE NOTICE 'Pessoa única: % clientes ligados (% pessoas criadas, % pendentes ativadas, % senhas de cliente descartadas).', ligadas, criadas, ativadas, descartadas;
END $$;

-- 5. Chaves e regras do vínculo; a senha e a verificação saem do cliente.
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "customers_business_id_user_id_key" ON "customers"("business_id", "user_id");
CREATE INDEX "customers_user_id_idx" ON "customers"("user_id");
ALTER TABLE "customers" ADD CONSTRAINT "customers_account_has_email" CHECK ("user_id" IS NULL OR "email" IS NOT NULL);
ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_together" CHECK (("user_id" IS NULL) = ("linked_at" IS NULL));
ALTER TABLE "customers" DROP COLUMN "password_hash", DROP COLUMN "email_verified_at";

-- 6. Conta ativa (com senha ou Google) sempre tem o e-mail verificado.
ALTER TABLE "users" ADD CONSTRAINT "users_active_verified"
  CHECK (("password_hash" IS NULL AND "google_sub" IS NULL) OR "email_verified_at" IS NOT NULL);

-- 7. A sessão guarda a última loja usada pelo cliente.
ALTER TABLE "sessions" ADD COLUMN "customer_business_id" UUID;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_customer_business_id_fkey" FOREIGN KEY ("customer_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sessions_customer_business_id_idx" ON "sessions"("customer_business_id");

-- 8. Códigos de e-mail viram tabela de plataforma (cadastro pela loja e troca de e-mail da pessoa).
DROP TABLE "verification_codes";
DROP TYPE "verification_purpose";
CREATE TYPE "email_code_purpose" AS ENUM ('SIGNUP', 'EMAIL_CHANGE');
CREATE TABLE "email_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "email_code_purpose" NOT NULL,
    -- SIGNUP: id da loja; EMAIL_CHANGE: id da pessoa.
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_codes_attempts_check" CHECK ("attempts" BETWEEN 0 AND 5),
    CONSTRAINT "email_codes_email_normalized_check" CHECK ("email" = lower(btrim("email")))
);
CREATE INDEX "email_codes_purpose_subject_email_idx" ON "email_codes"("purpose", "subject", "email");
CREATE INDEX "email_codes_expires_at_idx" ON "email_codes"("expires_at");
-- Um código vivo por (propósito, assunto, e-mail): pedir de novo substitui.
CREATE UNIQUE INDEX "email_codes_live_key" ON "email_codes"("purpose", "subject", "email") WHERE "consumed_at" IS NULL;

COMMIT;
