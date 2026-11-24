import type { TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'
import type { SchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { addMinutes } from '@/server/time'

/** Último instante em que o cliente ainda cancela ou remarca: o início menos o prazo da conta. */
export function customerChangeDeadline(startsAt: Date, changeWindowMin: number): Date {
  return addMinutes(startsAt, -changeWindowMin)
}

/** Regra única do prazo do cliente: exatamente no prazo ainda vale; um instante depois, não. */
export function withinCustomerWindow(now: Date, startsAt: Date, changeWindowMin: number): boolean {
  return now.getTime() <= customerChangeDeadline(startsAt, changeWindowMin).getTime()
}

function windowLabel(min: number): string {
  return min >= 60 && min % 60 === 0 ? `${min / 60} h` : `${min} min`
}

/** O cliente só cancela ou remarca até `customerChangeWindowMin` antes do início. */
export function assertCustomerWindow(ctx: TenantContext, rules: SchedulingRules, startsAt: Date, verb: string): void {
  if (!withinCustomerWindow(ctx.clock(), startsAt, rules.customerChangeWindowMin)) {
    throw new DomainError(
      'conflict',
      `O prazo para ${verb} pelo link da loja é de ${windowLabel(rules.customerChangeWindowMin)} antes do horário. Fale com o estabelecimento.`,
      { reason: 'too_late' },
    )
  }
}
