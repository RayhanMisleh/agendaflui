-- Relações entre tabelas de conta ficam na mesma conta: FK composta com business_id.
CREATE UNIQUE INDEX "uploads_business_id_id_key" ON "uploads"("business_id", "id");

ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_logo_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "logo_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("logo_upload_id") ON UPDATE CASCADE;

ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_symbol_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "symbol_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("symbol_upload_id") ON UPDATE CASCADE;

ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_favicon_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "favicon_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("favicon_upload_id") ON UPDATE CASCADE;

ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_login_image_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "login_image_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("login_image_upload_id") ON UPDATE CASCADE;
