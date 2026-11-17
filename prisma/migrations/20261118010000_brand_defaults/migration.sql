-- Padrão de conta nova = marca Agenda Flui (Água, Caramelo, barra Cheia, fundo Espuma).
-- Só o padrão das colunas muda: as contas existentes mantêm o que gravaram. O par de fontes padrão
-- continua 'CLASSIC', que agora é o par da marca (Bricolage Grotesque + Figtree).

-- AlterTable
ALTER TABLE "business_branding"
  ALTER COLUMN "primary_color" SET DEFAULT '#0B6E66',
  ALTER COLUMN "accent_color" SET DEFAULT '#F2A93B',
  ALTER COLUMN "cover_material" SET DEFAULT 'LEATHER',
  ALTER COLUMN "paper_tone" SET DEFAULT 'CREAM';
