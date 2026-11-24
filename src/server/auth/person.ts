import 'server-only'
import type { Prisma } from '@/server/db/generated/client'
import { enqueueCalendarForCustomerUserRaw } from '@/server/calendar/backfill'
import { searchKey } from '@/server/domain/customers/contact'
import { toIsoInstant } from '@/server/time'

/*
 * A pessoa da plataforma (`users`). Conta pendente = sem senha e sem Google (hoje só nasce de convite). Qualquer prova de
 * posse do e-mail (link do convite, código por e-mail, link de senha ou Google com o e-mail verificado) a ativa. Conta
 * ativa sempre tem `emailVerifiedAt` (CHECK `users_active_verified`).
 */

export type PersonState = 'pending' | 'active'
export type GoogleLink = { sub: string; email: string }

export function personState(u: { passwordHash: string | null; googleSub: string | null }): PersonState {
  return u.passwordHash === null && u.googleSub === null ? 'pending' : 'active'
}

/** Todo convite ainda aberto da pessoa deixa de valer (ela já tem como entrar). */
export async function consumeInvites(tx: Prisma.TransactionClient, userId: string, now: Date): Promise<void> {
  await tx.userToken.updateMany({ where: { userId, purpose: 'INVITE', usedAt: null }, data: { usedAt: now } })
}

/**
 * Ativa a conta pendente com senha ou Google: UPDATE condicional (`password_hash` e `google_sub` nulos), grava a
 * credencial, verifica o e-mail e consome os convites. `false` se a pessoa já estava ativa (nada muda).
 */
export async function activatePerson(
  tx: Prisma.TransactionClient,
  userId: string,
  how: { passwordHash: string } | { google: GoogleLink },
  now: Date,
): Promise<boolean> {
  // Um único UPDATE: o CHECK `users_active_verified` exige a verificação junto com a credencial. `coalesce` mantém a
  // verificação anterior (convite já provado).
  const agora = toIsoInstant(now)
  const ativada =
    'passwordHash' in how
      ? await tx.$executeRaw`
          UPDATE users SET password_hash = ${how.passwordHash}, email_verified_at = coalesce(email_verified_at, ${agora}::timestamptz), updated_at = ${agora}::timestamptz
          WHERE id = ${userId}::uuid AND password_hash IS NULL AND google_sub IS NULL`
      : await tx.$executeRaw`
          UPDATE users SET google_sub = ${how.google.sub}, google_email = ${how.google.email}, google_linked_at = ${agora}::timestamptz,
            email_verified_at = coalesce(email_verified_at, ${agora}::timestamptz), updated_at = ${agora}::timestamptz
          WHERE id = ${userId}::uuid AND password_hash IS NULL AND google_sub IS NULL`
  if (ativada !== 1) return false
  await consumeInvites(tx, userId, now)
  return true
}

/**
 * Copia nome, telefone e/ou e-mail da pessoa para todos os clientes ligados a ela (uma cópia por loja). O nome regrava
 * `search_name` e reenfileira no Google Agenda os agendamentos futuros já colocados. Chame na mesma transação que muda a pessoa.
 */
export async function syncCustomerCopies(
  tx: Prisma.TransactionClient,
  userId: string,
  data: { name?: string; phone?: string | null; email?: string },
  now: Date = new Date(),
): Promise<void> {
  const campos: Prisma.CustomerUncheckedUpdateManyInput = {
    ...(data.name !== undefined ? { name: data.name, searchName: searchKey(data.name) } : {}),
    ...(data.phone !== undefined ? { phone: data.phone } : {}),
    ...(data.email !== undefined ? { email: data.email } : {}),
  }
  if (Object.keys(campos).length === 0) return
  await tx.customer.updateMany({ where: { userId }, data: campos })
  // O evento do Google mostra o nome do cliente: quem já está numa agenda é reenviado.
  if (data.name !== undefined) await enqueueCalendarForCustomerUserRaw(tx, { userId, now })
}
