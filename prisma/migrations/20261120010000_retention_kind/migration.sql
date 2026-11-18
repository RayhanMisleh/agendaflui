-- Nova tarefa do agendador: a retenção diária de dados antigos.
ALTER TABLE "scheduler_runs" DROP CONSTRAINT "scheduler_runs_kind_check";
ALTER TABLE "scheduler_runs" ADD CONSTRAINT "scheduler_runs_kind_check" CHECK ("kind" IN ('notifications', 'cleanup', 'usage_flush', 'store', 'retention'));
