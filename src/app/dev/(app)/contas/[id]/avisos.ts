import { DEFAULT_NOTIFICATION_SETTINGS } from '@/server/domain/settings/notification-settings'

/**
 * Nome de cada tipo de aviso. Os TIPOS vêm do domínio (`DEFAULT_NOTIFICATION_SETTINGS`); aqui fica só o rótulo. Um teste
 * falha se o domínio ganhar um tipo sem rótulo, para a matriz nunca desligar em silêncio um tipo que a tela não mostra.
 */
export const ROTULOS_AVISO: Record<string, string> = {
  APPOINTMENT_REQUESTED: 'Pedido de agendamento recebido',
  APPOINTMENT_CONFIRMED: 'Agendamento confirmado',
  APPOINTMENT_CANCELED: 'Agendamento cancelado',
  APPOINTMENT_RESCHEDULED: 'Agendamento remarcado',
  APPOINTMENT_REMINDER_24H: 'Lembrete 24 horas antes',
  APPOINTMENT_REMINDER_1H: 'Lembrete 1 hora antes',
  APPOINTMENT_COMPLETED: 'Atendimento concluído',
  PROFESSIONAL_FREE_EARLY: 'Profissional livre mais cedo',
  STAFF_NEW_APPOINTMENT: 'Equipe: novo agendamento',
  STAFF_APPOINTMENT_CANCELED: 'Equipe: agendamento cancelado',
  STAFF_APPOINTMENT_RESCHEDULED: 'Equipe: agendamento remarcado',
}

/** Os avisos da matriz: os tipos do domínio, na ordem do domínio, com o rótulo da tela. */
export function tiposDeAviso(): Array<{ kind: string; label: string }> {
  return Object.keys(DEFAULT_NOTIFICATION_SETTINGS).map((kind) => ({ kind, label: ROTULOS_AVISO[kind] ?? kind }))
}
