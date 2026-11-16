-- Só acrescenta o valor: o Postgres não deixa usá-lo na mesma transação em que nasce.
ALTER TYPE "notification_kind" ADD VALUE 'APPOINTMENT_REQUESTED';
