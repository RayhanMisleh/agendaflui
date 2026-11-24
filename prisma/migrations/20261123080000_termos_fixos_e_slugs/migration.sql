-- Termos fixos (Profissional, Cliente, Pontos, Clube): saem as colunas de personalização.
-- `segment` sai; o nicho da conta chega na fase 2.
-- Endereço único: nenhuma loja pode usar um nome que é rota do sistema.
BEGIN;
DO $$
DECLARE reservados TEXT;
BEGIN
  SELECT string_agg("slug", ', ') INTO reservados FROM "businesses" WHERE "slug" IN ('entrar', 'sair', 'conta', 'convite', 'cadastro', 'esqueci-a-senha', 'redefinir-senha', 'definir-senha', 'google', 'painel', 'webhooks', 'arquivos', 'brand', 'healthz', 'api', 'dev', 'admin', 'www', 'suporte', 'app', 'ajuda', 'termos', 'privacidade');
  IF reservados IS NOT NULL THEN
    RAISE EXCEPTION 'Há loja com slug reservado pelo sistema (%); troque o slug antes de aplicar esta migração.', reservados;
  END IF;
END
$$;
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_slug_not_reserved" CHECK ("slug" NOT IN ('entrar', 'sair', 'conta', 'convite', 'cadastro', 'esqueci-a-senha', 'redefinir-senha', 'definir-senha', 'google', 'painel', 'webhooks', 'arquivos', 'brand', 'healthz', 'api', 'dev', 'admin', 'www', 'suporte', 'app', 'ajuda', 'termos', 'privacidade'));
ALTER TABLE "businesses" DROP COLUMN "segment";
ALTER TABLE "business_settings"
  DROP COLUMN "term_professional_singular", DROP COLUMN "term_professional_plural",
  DROP COLUMN "term_customer_singular", DROP COLUMN "term_customer_plural",
  DROP COLUMN "term_points_singular", DROP COLUMN "term_points_plural", DROP COLUMN "term_club";
COMMIT;
