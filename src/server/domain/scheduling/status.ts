import type { AppointmentStatus } from '@/server/db/generated/client'

/** Situações que ocupam o horário do profissional (as mesmas da restrição `appointments_no_overlap`). */
export const ACTIVE_STATUSES: readonly AppointmentStatus[] = ['PENDING', 'CONFIRMED', 'COMPLETED']

/** Situações em que o agendamento ainda pode acontecer (e que a equipe pode editar). */
export const OPEN_STATUSES: readonly AppointmentStatus[] = ['PENDING', 'CONFIRMED']

const TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELED'],
  CONFIRMED: ['CANCELED', 'COMPLETED', 'NO_SHOW'],
  COMPLETED: ['CONFIRMED'],
  CANCELED: [],
  NO_SHOW: ['CONFIRMED'],
}

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}
