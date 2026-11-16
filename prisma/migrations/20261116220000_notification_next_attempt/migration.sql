-- Próxima tentativa depois de uma falha; `scheduled_for` passa a ser só o horário previsto.
-- O índice (status, scheduled_for, locked_until) continua servindo à consulta de reserva (filtra por status e scheduled_for).
ALTER TABLE "notifications" ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3);
