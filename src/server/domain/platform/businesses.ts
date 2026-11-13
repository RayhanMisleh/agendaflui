import 'server-only'
import { prisma } from '@/server/db/client'
import type { BusinessStatus } from '@/server/db/generated/client'

export type BusinessListItem = { id: string; name: string; slug: string; status: BusinessStatus }

/** Contas para a lista do painel dev. Só campos de identificação: nada de observações, documento ou contato. */
export function listBusinesses(): Promise<BusinessListItem[]> {
  return prisma.business.findMany({
    select: { id: true, name: true, slug: true, status: true },
    orderBy: [{ createdAt: 'asc' }, { name: 'asc' }],
  })
}
