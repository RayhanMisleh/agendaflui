import { createHash } from 'node:crypto'
import type { TenantContext } from '@/server/auth/actor'
import { DomainError } from '@/server/domain/errors'
import { isClosedOn } from '@/server/domain/settings/closures'
import { loadDayOccupancy } from '@/server/domain/scheduling/availability'
import type { Db } from '@/server/domain/scheduling/appointment-view'
import { fitsWorkingHours, overlaps } from '@/server/domain/scheduling/slots'
import { ACTIVE_STATUSES } from '@/server/domain/scheduling/status'
import { addMinutes, formatTime, localParts } from '@/server/time'

export type ConfirmIssueKind = 'closed' | 'outside_hours' | 'blocked' | 'busy'
/** Uma coisa que a equipe precisa confirmar: `key` identifica o fato (entra na impressão), `text` é o que a tela mostra. */
export type ConfirmIssue = { kind: ConfirmIssueKind; key: string; text: string }
export type NearestSlot = { startsAt: Date; label: string; date: string }

const KIND_ORDER: Record<ConfirmIssueKind, number> = { closed: 0, outside_hours: 1, blocked: 2, busy: 3 }

/**
 * O que há no horário que a equipe vai ocupar, na ordem: loja fechada, fora do expediente, bloqueio e agendamentos (normais e
 * encaixes). Vazio = livre. Sem folga entre atendimentos: só sobreposição de fato.
 */
export async function staffIssues(
  ctx: TenantContext,
  db: Db,
  i: { professionalId: string; startsAt: Date; endsAt: Date; ignoreAppointmentId?: string },
): Promise<ConfirmIssue[]> {
  const tz = ctx.timeZone
  const interval = { start: i.startsAt, end: i.endsAt }
  const date = localParts(i.startsAt, tz).date
  const lastDate = localParts(addMinutes(i.endsAt, -1), tz).date
  const dates = date === lastDate ? [date] : [date, lastDate]
  const issues: ConfirmIssue[] = []

  for (const d of dates) {
    if (await isClosedOn(ctx, d, db)) issues.push({ kind: 'closed', key: `closed:${d}`, text: 'Loja fechada neste dia' })
  }

  const professional = await db.professional.findUnique({ where: { id: i.professionalId }, select: { name: true } })
  const name = professional?.name ?? 'o profissional'
  const day = await loadDayOccupancy(
    ctx,
    { professionalIds: [i.professionalId], date, bufferMin: 0, ...(i.ignoreAppointmentId ? { ignoreAppointmentId: i.ignoreAppointmentId } : {}) },
    db,
  )
  const ranges = day.get(i.professionalId)?.workingRanges ?? []
  const fits =
    date === lastDate && ranges.length > 0 && fitsWorkingHours({ start: i.startsAt, end: i.endsAt, date, timeZone: tz, workingRanges: ranges })
  if (!fits) issues.push({ kind: 'outside_hours', key: `outside:${i.professionalId}:${date}`, text: `Fora do expediente de ${name}` })

  const blocks = await db.timeBlock.findMany({
    where: { professionalId: i.professionalId, startsAt: { lt: i.endsAt }, endsAt: { gt: i.startsAt } },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  for (const b of blocks) {
    const reason = b.reason ? ` (${b.reason})` : ''
    issues.push({
      kind: 'blocked',
      key: `blocked:${b.id}`,
      text: `Agenda de ${name} bloqueada das ${formatTime(b.startsAt, tz)} às ${formatTime(b.endsAt, tz)}${reason}`,
    })
  }

  const rows = await db.appointment.findMany({
    where: {
      professionalId: i.professionalId,
      status: { in: [...ACTIVE_STATUSES] },
      startsAt: { lt: i.endsAt },
      endsAt: { gt: i.startsAt },
      ...(i.ignoreAppointmentId ? { id: { not: i.ignoreAppointmentId } } : {}),
    },
    orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
  })
  for (const a of rows) {
    if (!overlaps(interval, { start: a.startsAt, end: a.endsAt })) continue
    // Em sequência (sem `include`): dentro de uma transação, o cliente do banco atende uma consulta por vez.
    const items = await db.appointmentItem.findMany({ where: { appointmentId: a.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { name: true } })
    const pet = a.petId === null ? null : await db.pet.findUnique({ where: { id: a.petId }, select: { name: true } })
    const customer = pet === null ? await db.customer.findUnique({ where: { id: a.customerId }, select: { name: true } }) : null
    const who = pet?.name ?? customer?.name ?? ''
    const what = items.map((item) => item.name).join(' + ')
    issues.push({
      kind: 'busy',
      key: `busy:${a.id}`,
      text: `${formatTime(a.startsAt, tz)}–${formatTime(a.endsAt, tz)} já tem ${who}${what === '' ? '' : ` (${what})`}`,
    })
  }
  return issues.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
}

/**
 * A impressão do que a pessoa viu: profissional, início, fim e as chaves dos conflitos. Vale só para esse pedido; se algo mudou
 * (outro membro marcou no horário, o horário ou o profissional mudou), a impressão deixa de bater e o servidor pede de novo.
 */
export function acknowledgementOf(i: { professionalId: string; startsAt: Date; endsAt: Date; issues: readonly ConfirmIssue[] }): string {
  const keys = i.issues.map((x) => x.key).sort()
  const canonical = JSON.stringify([i.professionalId, i.startsAt.getTime(), i.endsAt.getTime(), keys])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

/** Erro de domínio que pede a confirmação da equipe: nada foi gravado. */
export function needsConfirmation(i: {
  professionalId: string
  professionalName: string
  issues: ConfirmIssue[]
  acknowledgement: string
  nearest: NearestSlot[]
}): DomainError {
  return new DomainError('conflict', 'Confira o horário antes de salvar.', {
    reason: 'needs_confirmation',
    details: {
      issues: i.issues,
      acknowledgement: i.acknowledgement,
      professionalId: i.professionalId,
      professionalName: i.professionalName,
      nearest: i.nearest,
    },
  })
}
