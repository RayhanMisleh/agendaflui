-- CreateIndex
CREATE INDEX "appointments_business_id_ends_at_idx" ON "appointments"("business_id", "ends_at");
