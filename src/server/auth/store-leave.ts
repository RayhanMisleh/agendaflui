import 'server-only'
import { prisma } from '@/server/db/client'
import { audit } from '@/server/domain/audit'
import { anonymizeCustomer } from '@/server/domain/customers/customers'
import { DomainError } from '@/server/domain/errors'
import { removeUploadFile } from '@/server/storage/images'
import { AuthError } from './actor'
import { createTenantContext } from './context'
import { destinationFor, destinationForUser, destinationPath } from './destination'
import { verifyPassword } from './password'
import { lockUserAccess } from './password-reset'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey } from './rate-limit-db'
import { getPersonSession } from './session'
import type { RequestMeta } from './support-session'

/*
 * "Excluir minha conta nesta loja": o cliente sai SÓ desta loja (o cadastro dele nela é anonimizado: nome, telefone, e-mail,
 * endereços e observações somem; os agendamentos e pedidos ficam sem dado pessoal). A pessoa só é apagada de vez se não resta
 * nenhum vínculo dela em loja nenhuma, nem de cliente nem de equipe (mesmo inativo): aí sessões e tokens caem junto.
 */

export const DELETE_CONFIRM_WORD = 'excluir'

const senhaErrada = (): DomainError =>
  new DomainError('validation', 'Confira os campos informados e tente de novo.', { reason: 'wrong_password', fields: { password: 'Senha incorreta.' } })

const falta = (): DomainError => new DomainError('validation', 'Confira os campos informados e tente de novo.', { fields: { confirm: `Digite ${DELETE_CONFIRM_WORD} para confirmar.` } })

/** Quem tem senha confirma com ela (mesmo limite de `setPersonPassword`); quem só tem Google digita a palavra. */
async function confirmIdentity(userId: string, i: { password?: string | null; confirm?: string | null }, now: Date): Promise<void> {
  const pessoa = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } })
  if (!pessoa) throw new DomainError('not_found', 'Conta não encontrada.')
  if (pessoa.passwordHash === null) {
    if ((i.confirm ?? '').trim().toLowerCase() !== DELETE_CONFIRM_WORD) throw falta()
    return
  }
  const chave = limitKey('senha-pessoa', userId)
  const tentativa = await hitRateLimit(chave, LIMITS.loginEmail, now)
  if (!tentativa.allowed) throw new AuthError('rate_limited', tentativa.retryAfterSec)
  const senha = i.password ?? ''
  if (senha === '' || !(await verifyPassword(pessoa.passwordHash, senha))) throw senhaErrada()
  await clearRateLimit(chave)
}

export async function deleteStoreAccount(
  i: { userId: string; businessId: string; customerId: string; password?: string | null; confirm?: string | null; sessionToken: string },
  _meta: RequestMeta,
  now: Date,
): Promise<{ personDeleted: boolean; nextPath: string }> {
  // O cadastro tem de ser desta pessoa nesta loja (a ação já sabe, mas o id vem de fora até aqui).
  const cliente = await prisma.customer.findFirst({
    where: { id: i.customerId, businessId: i.businessId, userId: i.userId, archivedAt: null, anonymizedAt: null },
    select: { id: true, name: true },
  })
  if (!cliente) throw new DomainError('not_found', 'Cadastro não encontrado.')
  await confirmIdentity(i.userId, i, now)

  const ctx = await createTenantContext({
    businessId: i.businessId,
    actor: { kind: 'customer', customerId: cliente.id, name: cliente.name },
    clock: () => now,
    channel: 'app',
  })
  // Pedido em andamento: a recusa do domínio sobe como está e nada muda.
  await anonymizeCustomer(ctx, cliente.id)

  const resultado = await prisma.$transaction(async (tx) => {
    await lockUserAccess(tx, i.userId)
    const [clientes, vinculos] = await Promise.all([tx.customer.count({ where: { userId: i.userId } }), tx.membership.count({ where: { userId: i.userId } })])
    if (clientes > 0 || vinculos > 0) {
      // Fica a pessoa: as sessões dela que lembravam esta loja deixam de lembrar.
      await tx.session.updateMany({ where: { userId: i.userId, customerBusinessId: i.businessId }, data: { customerBusinessId: null } })
      return { personDeleted: false, avatarPath: null as string | null }
    }
    const pessoa = await tx.user.findUnique({ where: { id: i.userId }, select: { avatarUploadId: true } })
    await tx.emailCode.deleteMany({ where: { purpose: 'EMAIL_CHANGE', subject: i.userId } })
    await tx.user.delete({ where: { id: i.userId } })
    let avatarPath: string | null = null
    if (pessoa?.avatarUploadId) {
      const arquivo = await tx.upload.findUnique({ where: { id: pessoa.avatarUploadId }, select: { path: true } })
      await tx.upload.deleteMany({ where: { id: pessoa.avatarUploadId } })
      avatarPath = arquivo?.path ?? null
    }
    return { personDeleted: true, avatarPath }
  })
  if (resultado.avatarPath !== null) await removeUploadFile(resultado.avatarPath)
  await audit(ctx, { action: 'customer.account_deleted_by_customer', targetType: 'Customer', targetId: cliente.id, metadata: { personDeleted: resultado.personDeleted } })
  if (resultado.personDeleted) return { personDeleted: true, nextPath: '/entrar?conta=excluida' }
  // As sessões já esqueceram esta loja: o destino sai da própria sessão (ou, sem ela, dos vínculos que restam).
  const sessao = await getPersonSession(i.sessionToken, now)
  return { personDeleted: false, nextPath: destinationPath(sessao ? await destinationFor(sessao) : await destinationForUser(i.userId, null)) }
}
