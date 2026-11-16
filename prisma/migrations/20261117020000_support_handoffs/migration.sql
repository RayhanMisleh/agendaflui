-- CreateTable
CREATE TABLE "support_handoffs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_handoffs_token_hash_key" ON "support_handoffs"("token_hash");

-- CreateIndex
CREATE INDEX "support_handoffs_admin_id_idx" ON "support_handoffs"("admin_id");

-- CreateIndex
CREATE INDEX "support_handoffs_business_id_idx" ON "support_handoffs"("business_id");

-- AddForeignKey
ALTER TABLE "support_handoffs" ADD CONSTRAINT "support_handoffs_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_handoffs" ADD CONSTRAINT "support_handoffs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
