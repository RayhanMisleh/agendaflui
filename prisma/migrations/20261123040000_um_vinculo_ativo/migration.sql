-- Cada login da equipe pertence a uma loja só: um usuário tem no máximo um vínculo ATIVO.
-- Vínculos desativados continuam valendo como histórico. Admins da plataforma não têm vínculo e ficam fora da regra.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "memberships" WHERE "active" GROUP BY "user_id" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Há usuários com mais de um vínculo ativo; resolva antes de aplicar (veja o plano 2026-11-23, Nota do coordenador).';
  END IF;
END
$$;

CREATE UNIQUE INDEX "memberships_one_active_per_user" ON "memberships"("user_id") WHERE "active";
