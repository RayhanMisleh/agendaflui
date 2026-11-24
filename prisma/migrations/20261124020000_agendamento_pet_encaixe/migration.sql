-- Agendamento com pet, encaixe e duração livre da equipe.
BEGIN;

ALTER TABLE "appointments" ADD COLUMN "pet_id" UUID;
ALTER TABLE "appointments" ADD COLUMN "is_squeeze_in" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "appointment_items" ADD COLUMN "variant" "price_variant";

CREATE INDEX "appointments_business_id_pet_id_starts_at_idx" ON "appointments"("business_id", "pet_id", "starts_at");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_pet_id_fkey"
  FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- O pet é do cliente do agendamento. MATCH SIMPLE deixa pet_id nulo passar (agendamentos antigos e contas sem nicho).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_pet_id_same_customer_fkey"
  FOREIGN KEY ("business_id", "customer_id", "pet_id") REFERENCES "pets"("business_id", "customer_id", "id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- A equipe escolhe a duração (5 a 720 minutos); o teto vale para toda marcação.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_duration_max_check" CHECK ("total_duration_min" <= 720);

-- Dois agendamentos normais sobrepostos do mesmo profissional continuam impossíveis; o encaixe fica de fora.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist ("professional_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("status" IN ('PENDING', 'CONFIRMED', 'COMPLETED') AND NOT "is_squeeze_in");

COMMIT;
