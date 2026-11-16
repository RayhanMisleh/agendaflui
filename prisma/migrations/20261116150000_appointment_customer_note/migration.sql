-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "customer_note" TEXT;

-- O domínio já limita a 500 caracteres; a restrição protege o banco de gravações por outro caminho.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_note_check" CHECK ("customer_note" IS NULL OR char_length("customer_note") <= 500);
