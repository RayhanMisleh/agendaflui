-- A FK composta com business_id não pode propagar mudança de business_id (ON UPDATE CASCADE moveria a marca
-- junto com o upload para outra conta). Recria as quatro com ON UPDATE NO ACTION.

ALTER TABLE "business_branding" DROP CONSTRAINT "business_branding_logo_upload_same_business_fkey";
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_logo_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "logo_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("logo_upload_id") ON UPDATE NO ACTION;

ALTER TABLE "business_branding" DROP CONSTRAINT "business_branding_symbol_upload_same_business_fkey";
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_symbol_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "symbol_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("symbol_upload_id") ON UPDATE NO ACTION;

ALTER TABLE "business_branding" DROP CONSTRAINT "business_branding_favicon_upload_same_business_fkey";
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_favicon_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "favicon_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("favicon_upload_id") ON UPDATE NO ACTION;

ALTER TABLE "business_branding" DROP CONSTRAINT "business_branding_login_image_upload_same_business_fkey";
ALTER TABLE "business_branding" ADD CONSTRAINT "business_branding_login_image_upload_same_business_fkey"
  FOREIGN KEY ("business_id", "login_image_upload_id") REFERENCES "uploads"("business_id", "id")
  ON DELETE SET NULL ("login_image_upload_id") ON UPDATE NO ACTION;
