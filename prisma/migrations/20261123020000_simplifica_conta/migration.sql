-- Conta mais simples: sem razão social, observações internas, fundo, par de fontes e mensagem da tela de entrada.
ALTER TABLE "businesses" DROP COLUMN "legal_name",
DROP COLUMN "internal_notes";

ALTER TABLE "business_branding" DROP COLUMN "login_message",
DROP COLUMN "paper_tone",
DROP COLUMN "font_pair";

DROP TYPE "paper_tone";
DROP TYPE "font_pair";
