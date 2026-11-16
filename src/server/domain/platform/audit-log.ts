import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { assertPlatformAdmin } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import type { MembershipRole, Prisma } from '@/server/db/generated/client'
import { DomainError, parse, z } from '@/server/domain/errors'
import { addMinutes, fromEpochMs } from '@/server/time'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export type AuditRow = {
  id: string
  at: Date
  actorLabel: string
  action: string
  businessId: string | null
  businessName: string | null
  targetLabel: string | null
  /** Como foi gravada (a auditoria nunca guarda segredo). */
  metadata: unknown
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const DEFAULT_RANGE_DAYS = 30
const MAX_RANGE_DAYS = 92
const DAY_MIN = 24 * 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR = /^(\d{1,16})\.([0-9a-f-]{36})$/i

const ROLE_LABEL: Record<MembershipRole, string> = { OWNER: 'Dono', MANAGER: 'Gerente', PROFESSIONAL: 'Profissional' }

const querySchema = z.object({
  businessId: z.uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  actorType: z.enum(['PLATFORM_ADMIN', 'USER', 'SYSTEM']).optional(),
  from: z.date().optional(),
  to: z.date().optional(),
  cursor: z.string().max(100).optional(),
  limit: z.number().int().min(1, 'Use de 1 a 100 linhas por página.').max(MAX_LIMIT, 'Use de 1 a 100 linhas por página.').optional(),
})

function decodeCursor(cursor: string): { at: Date; id: string } {
  const m = CURSOR.exec(cursor)
  const id = m?.[2]
  if (!m || !id || !UUID.test(id)) {
    throw new DomainError('validation', 'A página pedida não existe mais. Volte à primeira página.', { fields: { cursor: 'Página inválida.' } })
  }
  try {
    return { at: fromEpochMs(Number(m[1])), id }
  } catch {
    throw new DomainError('validation', 'A página pedida não existe mais. Volte à primeira página.', { fields: { cursor: 'Página inválida.' } })
  }
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return `${row.createdAt.getTime()}.${row.id}`
}

function isCustomerRow(metadata: unknown): boolean {
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && typeof Reflect.get(metadata, 'customerId') === 'string'
}

/**
 * Lista a auditoria para o painel dev: mais recentes primeiro, com filtros combináveis (conta, ação, tipo de autor, período).
 * O período padrão são os últimos 30 dias e vai até 92 dias (`from` inclusivo, `to` exclusivo). A página seguinte parte do
 * cursor (`createdAt` + `id`), então linhas novas ou com o mesmo instante não repetem nem pulam. `now` só define o padrão.
 */
export async function listAudit(
  actor: PlatformAdminActor,
  q: { businessId?: string; action?: string; actorType?: string; from?: Date; to?: Date; cursor?: string; limit?: number },
  now: Date = new Date(),
): Promise<{ items: AuditRow[]; nextCursor: string | null }> {
  assertPlatformAdmin(actor)
  const i = parse(querySchema, q)
  const to = i.to ?? now
  const from = i.from ?? addMinutes(to, -DEFAULT_RANGE_DAYS * DAY_MIN)
  if (to.getTime() <= from.getTime()) {
    throw new DomainError('validation', 'O fim do período precisa ser depois do início.', { fields: { to: 'Escolha uma data depois do início.' } })
  }
  if (to.getTime() > addMinutes(from, MAX_RANGE_DAYS * DAY_MIN).getTime()) {
    throw new DomainError('validation', `Escolha um período de até ${MAX_RANGE_DAYS} dias.`, { fields: { to: `O período vai até ${MAX_RANGE_DAYS} dias.` } })
  }
  const limit = i.limit ?? DEFAULT_LIMIT
  const cursor = i.cursor === undefined ? null : decodeCursor(i.cursor)

  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(i.businessId !== undefined ? { businessId: i.businessId } : {}),
    ...(i.action !== undefined ? { action: i.action } : {}),
    ...(i.actorType !== undefined ? { actorType: i.actorType } : {}),
    ...(cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}),
  }
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: { business: { select: { name: true } } },
  })
  const page = rows.slice(0, limit)
  const last = page.at(-1)

  // Papel de quem agiu como membro: um vínculo por (conta, usuário), lido só para as linhas desta página.
  const pares = page.flatMap((r) => (r.actorType === 'USER' && r.businessId && r.actorId ? [{ businessId: r.businessId, userId: r.actorId }] : []))
  const vinculos = pares.length === 0 ? [] : await prisma.membership.findMany({ where: { OR: pares }, select: { businessId: true, userId: true, role: true } })
  const papel = new Map(vinculos.map((v) => [`${v.businessId}:${v.userId}`, v.role]))

  const items = page.map((r): AuditRow => {
    let actorLabel: string
    if (r.actorType === 'PLATFORM_ADMIN') {
      actorLabel = r.onBehalf ? `Admin ${r.actorName} em suporte` : `Admin ${r.actorName}`
    } else if (r.actorType === 'USER') {
      const role = r.businessId && r.actorId ? papel.get(`${r.businessId}:${r.actorId}`) : undefined
      actorLabel = `${role ? ROLE_LABEL[role] : 'Membro'} ${r.actorName}`
    } else {
      actorLabel = isCustomerRow(r.metadata) ? 'Cliente' : 'Sistema'
    }
    return {
      id: r.id,
      at: r.createdAt,
      actorLabel,
      action: r.action,
      businessId: r.businessId,
      businessName: r.business?.name ?? null,
      targetLabel: r.targetType ? (r.targetId ? `${r.targetType} ${r.targetId.slice(0, 8)}` : r.targetType) : null,
      metadata: r.metadata,
    }
  })
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last) : null }
}
