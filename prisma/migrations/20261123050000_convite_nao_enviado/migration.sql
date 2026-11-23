-- Convite que não saiu: quando o e-mail de convite (ou de acesso) não é aceito pelo canal, o vínculo guarda o instante.
-- A ficha e a lista da equipe mostram "Convite não enviado" com "Reenviar"; um envio que dá certo volta a coluna para NULL.
ALTER TABLE "memberships" ADD COLUMN "invite_mail_failed_at" TIMESTAMPTZ(3);
