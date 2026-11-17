import type { TenantContext } from '@/server/auth/actor'
import type { AppointmentStatus } from '@/server/db/generated/client'
import { DomainError, parse, z } from '@/server/domain/errors'
import {
  appointmentWhere,
  REPORT_STATUSES,
  resolveScope,
  seesCommissionOf,
  type ReportFilter,
  type ReportScope,
} from '@/server/domain/reports/shared'
import { formatDateTime, fromEpochMs } from '@/server/time'

export type ReportRow = {
  id: string
  /** Rótulos no fuso da conta: `DD/MM/AAAA HH:mm`. */
  startLabel: string
  endLabel: string
  customerName: string
  professionalId: string
  professionalName: string
  services: string[]
  status: AppointmentStatus
  totalCents: number
  commissionCents: number | null
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

const pageSchema = z.object({
  cursor: z.string().optional(),
  limit: z
    .number()
    .int('Use um número inteiro.')
    .min(1, 'Use pelo menos 1 item.')
    .max(MAX_LIMIT, `Use no máximo ${MAX_LIMIT} itens por página.`)
    .optional(),
})

type Cursor = { endsAt: Date; id: string }

function encodeCursor(row: Cursor): string {
  return Buffer.from(JSON.stringify([row.endsAt.getTime(), row.id])).toString('base64url')
}

function decodeCursor(cursor: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'number' &&
      Number.isSafeInteger(parsed[0]) &&
      typeof parsed[1] === 'string' &&
      z.uuid().safeParse(parsed[1]).success
    ) {
      return { endsAt: fromEpochMs(parsed[0]), id: parsed[1] }
    }
  } catch {
    // cai no erro abaixo
  }
  throw new DomainError('validation', 'O cursor de paginação é inválido. Recarregue o relatório.', {
    fields: { cursor: 'Cursor inválido.' },
  })
}

/** Uma página, em ordem estável (término e id). Usada pela lista e pelo CSV, que lê de 500 em 500. */
export async function readReportPage(
  ctx: TenantContext,
  scope: ReportScope,
  cursor: string | undefined,
  limit: number,
): Promise<{ items: ReportRow[]; nextCursor: string | null }> {
  const after = cursor === undefined ? null : decodeCursor(cursor)
  const rows = await ctx.db.appointment.findMany({
    where: {
      AND: [
        appointmentWhere(scope, REPORT_STATUSES),
        ...(after
          ? [{ OR: [{ endsAt: { gt: after.endsAt } }, { endsAt: after.endsAt, id: { gt: after.id } }] }]
          : []),
      ],
    },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      totalCents: true,
      commissionCents: true,
      professionalId: true,
      professional: { select: { name: true } },
      customer: { select: { name: true } },
      items: { select: { name: true }, orderBy: { position: 'asc' } },
    },
    orderBy: [{ endsAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map((r) => ({
      id: r.id,
      startLabel: formatDateTime(r.startsAt, ctx.timeZone),
      endLabel: formatDateTime(r.endsAt, ctx.timeZone),
      customerName: r.customer.name,
      professionalId: r.professionalId,
      professionalName: r.professional.name,
      services: r.items.map((i) => i.name),
      status: r.status,
      totalCents: r.totalCents,
      commissionCents:
        r.status === 'COMPLETED' && seesCommissionOf(scope, r.professionalId) ? (r.commissionCents ?? 0) : null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  }
}

export async function listReportRows(
  ctx: TenantContext,
  f: ReportFilter & { cursor?: string; limit?: number },
): Promise<{ items: ReportRow[]; nextCursor: string | null }> {
  const { cursor, limit, ...filter } = f
  const page = parse(pageSchema, { cursor, limit })
  const scope = await resolveScope(ctx, filter)
  return readReportPage(ctx, scope, page.cursor, page.limit ?? DEFAULT_LIMIT)
}
