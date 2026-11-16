-- Um código vivo (não consumido) por conta, propósito e e-mail. Pedir de novo consome o vivo antes de criar o novo.
CREATE UNIQUE INDEX "verification_codes_live_key" ON "verification_codes"("business_id", "purpose", "email") WHERE "consumed_at" IS NULL;
