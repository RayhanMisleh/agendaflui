import 'server-only'
import { prisma } from '@/server/db/client'
import type { Prisma } from '@/server/db/generated/client'
import { lockKeyRaw } from '@/server/db/tenant'
import { searchKey } from '@/server/domain/customers/contact'
import { DomainError, isUniqueViolation } from '@/server/domain/errors'
import { isReservedSlug } from '@/shared/reserved-slugs'
import { lockUserAccess } from './password-reset'

/*
 * Entrar numa loja como cliente. A pessoa só vira cliente por ação explícita (entrar ou cadastrar pelo link da loja, "Usar minha
 * conta"): abrir `/<slug>` com sessão não cria nada (`storeRelation` só lê). Se a loja tem um cliente de balcão com o mesmo
 * e-mail da pessoa (que sempre tem e-mail verificado), ele é ADOTADO: a pessoa passa a ser dona dele e o histórico fica.
 *
 * Ordem de travas: `lockUserAccess` da pessoa primeiro, depois `customer` da loja (ver `docs/ARQUITETURA.md`).
 */

export type StoreRef = { businessId: string; slug: string; name: string }

export type JoinResult = { kind: 'joined' | 'adopted' | 'already'; customerId: string } | { kind: 'blocked' }

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** A loja aberta ao público (conta ativa) pelo endereço. Formato inválido, nome reservado, inexistente ou não ativa: `null`. */
export async function findOpenStore(slug: string): Promise<StoreRef | null> {
  if (typeof slug !== 'string' || slug.length > 40 || !SLUG.test(slug) || isReservedSlug(slug)) return null
  const b = await prisma.business.findFirst({
    where: { slug, status: 'ACTIVE' },
    select: { id: true, slug: true, name: true, branding: { select: { displayName: true } } },
  })
  return b ? { businessId: b.id, slug: b.slug, name: b.branding?.displayName || b.name } : null
}

const inativo = (c: { archivedAt: Date | null; anonymizedAt: Date | null }): boolean => c.archivedAt !== null || c.anonymizedAt !== null

/** Lê a situação da pessoa na loja e decide: já cliente, bloqueada, balcão a adotar ou nada (criar). */
async function situacao(tx: Prisma.TransactionClient, userId: string, businessId: string, email: string) {
  const ligado = await tx.customer.findUnique({ where: { businessId_userId: { businessId, userId } } })
  if (ligado) return { tipo: inativo(ligado) ? ('blocked' as const) : ('already' as const), id: ligado.id }
  const balcao = await tx.customer.findFirst({ where: { businessId, email, userId: null, anonymizedAt: null } })
  if (balcao) return balcao.archivedAt !== null ? { tipo: 'blocked' as const, id: balcao.id } : { tipo: 'adopt' as const, id: balcao.id }
  return { tipo: 'create' as const, id: null }
}

/**
 * Liga a pessoa à loja, na transação do chamador (que já deve ter chamado `lockUserAccess`). Violação de unicidade
 * (outro cadastro com o mesmo e-mail surgiu agora) aborta a transação: quem chama repete a transação inteira uma vez
 * (`joinStore` faz isso).
 */
export async function joinStoreIn(tx: Prisma.TransactionClient, userId: string, businessId: string, now: Date): Promise<JoinResult> {
  const pessoa = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  if (pessoa.emailVerifiedAt === null) throw new DomainError('conflict', 'Confirme o seu e-mail antes de entrar numa loja.')
  const s = await situacao(tx, userId, businessId, pessoa.email)
  switch (s.tipo) {
    case 'blocked':
      return { kind: 'blocked' }
    case 'already':
      return { kind: 'already', customerId: s.id }
    case 'adopt': {
      await lockKeyRaw(tx, businessId, 'customer', s.id)
      // Relê sob a trava: o cadastro pode ter sido arquivado, apagado ou adotado por outra chamada.
      const adotado = await tx.customer.updateMany({
        where: { id: s.id, userId: null, archivedAt: null, anonymizedAt: null },
        data: { userId, linkedAt: now },
      })
      if (adotado.count === 1) {
        // Telefone vazio recebe o da pessoa; nome, histórico e observações da loja ficam.
        if (pessoa.phone !== null) await tx.customer.updateMany({ where: { id: s.id, phone: null }, data: { phone: pessoa.phone } })
        return { kind: 'adopted', customerId: s.id }
      }
      const denovo = await situacao(tx, userId, businessId, pessoa.email)
      if (denovo.tipo === 'already') return { kind: 'already', customerId: denovo.id }
      return { kind: 'blocked' }
    }
    case 'create': {
      const criado = await tx.customer.create({
        data: {
          businessId,
          name: pessoa.name,
          searchName: searchKey(pessoa.name),
          email: pessoa.email,
          phone: pessoa.phone,
          origin: 'APP',
          userId,
          linkedAt: now,
        },
        select: { id: true },
      })
      return { kind: 'joined', customerId: criado.id }
    }
  }
}

/** Liga a pessoa à loja numa transação própria (trava a pessoa antes). Corrida com outro cadastro: repete uma vez. */
export async function joinStore(userId: string, businessId: string, now: Date): Promise<JoinResult> {
  for (let tentativa = 0; ; tentativa++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockUserAccess(tx, userId)
        return joinStoreIn(tx, userId, businessId, now)
      })
    } catch (err) {
      if (!isUniqueViolation(err) || tentativa >= 1) throw err
    }
  }
}

/** O que a pessoa é na loja, só leitura (abrir a página da loja nunca cria nada). */
export async function storeRelation(
  userId: string | null,
  businessId: string,
): Promise<{ isCustomer: boolean; isStaff: boolean; blocked: boolean }> {
  if (userId === null) return { isCustomer: false, isStaff: false, blocked: false }
  const [pessoa, ligado, vinculo] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.customer.findUnique({ where: { businessId_userId: { businessId, userId } }, select: { archivedAt: true, anonymizedAt: true } }),
    prisma.membership.findFirst({ where: { userId, businessId, active: true }, select: { id: true } }),
  ])
  const isStaff = vinculo !== null
  if (ligado) return { isCustomer: !inativo(ligado), isStaff, blocked: inativo(ligado) }
  // Balcão arquivado com o e-mail da pessoa: entrar não reativa.
  const balcao = pessoa
    ? await prisma.customer.findFirst({ where: { businessId, email: pessoa.email, userId: null, anonymizedAt: null }, select: { archivedAt: true } })
    : null
  return { isCustomer: false, isStaff, blocked: balcao !== null && balcao.archivedAt !== null }
}
