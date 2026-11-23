-- Avisos de toda a loja: dono e gerente podem escolher receber (só por push) os avisos de todos os agendamentos feitos pelos clientes.
-- Desligado por padrão; quem não é dono nem gerente não consegue ligar (a regra fica no domínio e na conferência do envio).
ALTER TABLE "memberships" ADD COLUMN "notify_all_appointments" BOOLEAN NOT NULL DEFAULT false;
