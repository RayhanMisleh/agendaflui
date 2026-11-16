import { addMinutes } from '@/server/time'

/** Último instante em que o cliente ainda cancela ou remarca: o início menos o prazo da conta. */
export function customerChangeDeadline(startsAt: Date, changeWindowMin: number): Date {
  return addMinutes(startsAt, -changeWindowMin)
}

/** Regra única do prazo do cliente: exatamente no prazo ainda vale; um instante depois, não. */
export function withinCustomerWindow(now: Date, startsAt: Date, changeWindowMin: number): boolean {
  return now.getTime() <= customerChangeDeadline(startsAt, changeWindowMin).getTime()
}
