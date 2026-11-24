import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { AuthError } from '@/server/auth/actor'
import { verifyPassword } from '@/server/auth/password'
import { requestPasswordReset, resetPassword } from '@/server/auth/password-reset'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import { changeOwnAccountPassword } from '@/server/domain/account/profile'
import { DomainError } from '@/server/domain/errors'
import { sendAccessPasswordReset, setAccessActive } from '@/server/domain/team/access'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeCtx, makeMembership, makeUser, memberOf } from '../setup/factories'
import { fakeMail } from '../setup/mail'
import type { TenantContext } from '@/server/auth/actor'

/*
 * Ordem única de travas nos acessos: business_owners -> vínculos (id crescente) -> usuário -> tokens e sessões.
 * Cada par abaixo já travou em ordem oposta (deadlock do Postgres, 40P01). Várias rodadas com `allSettled`: nenhuma
 * promessa pode falhar por erro inesperado, e o estado final precisa ser coerente.
 */

const AGORA = new Date('2026-11-17T12:00:00.000Z')
const RODADAS = 8
const META = { ip: '203.0.113.7' }
const mail = fakeMail()
let businessId: string
let dono: TenantContext

beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ name: 'Barbearia Central' })).id
  dono = await ctxWithRole({ id: businessId }, 'OWNER', { now: AGORA })
  mail.install()
})
afterEach(() => mail.uninstall())

/** Dispara `n` chamadas escalonadas de `passoMs` em `passoMs`: cobre a janela em que a outra transação está aberta. */
const escalonar = <T,>(n: number, passoMs: number, fn: () => Promise<T>): Promise<T>[] =>
  Array.from({ length: n }, (_, k) => new Promise<void>((ok) => setTimeout(ok, k * passoMs)).then(fn))

const esperado = (r: PromiseSettledResult<unknown>): boolean =>
  r.status === 'fulfilled' || r.reason instanceof DomainError || r.reason instanceof AuthError

function inesperados(r: PromiseSettledResult<unknown>[]): unknown[] {
  return r.filter((x) => !esperado(x)).map((x) => (x as PromiseRejectedResult).reason)
}

async function membroComToken() {
  const user = await makeUser({ password: 'senha-antiga-1' })
  const outra = await makeBusiness()
  const m1 = await makeMembership(businessId, user.id, 'PROFESSIONAL')
  // O vínculo de outra loja é histórico (desativado): um login tem um vínculo ativo só, mas os tokens dele ainda caem.
  await prisma.membership.create({ data: { businessId: outra.id, userId: user.id, role: 'MANAGER', active: false } })
  const token = randomUUID()
  await prisma.userToken.create({ data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken(token), expiresAt: addMinutes(AGORA, 60) } })
  return { user, membership: m1, token }
}

const senhaDe = async (id: string, texto: string) => verifyPassword((await prisma.user.findUniqueOrThrow({ where: { id } })).passwordHash ?? '', texto)

describe('pares que travavam em ordem oposta', { timeout: 120_000 }, () => {
  test('(a) dono envia a redefinição enquanto a pessoa redefine ou troca a senha', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const { user, membership, token } = await membroComToken()
      const euCtx = await makeCtx(
        { id: businessId },
        { now: AGORA, actor: { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role: 'PROFESSIONAL' } },
      )
      const r = await Promise.allSettled([
        ...escalonar(10, 8, () => sendAccessPasswordReset(dono, membership.id)),
        ...Array.from({ length: 4 }, () => resetPassword({ token, password: 'senha-nova-bem-longa' }, META, AGORA)),
        changeOwnAccountPassword(euCtx, { current: 'senha-antiga-1', next: 'outra-nova-senha-1' }, 'x'),
      ])
      expect(inesperados(r)).toEqual([])
      const hash = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash
      expect(hash).not.toBeNull()
      const mudou = r.slice(10).some((x) => x.status === 'fulfilled')
      expect(await senhaDe(user.id, 'senha-antiga-1')).toBe(!mudou)
    }
  })

  test('(b) redefinir com o token enquanto pede nova redefinição ou troca a senha', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const { user, membership, token } = await membroComToken()
      const euCtx = await makeCtx(
        { id: businessId },
        { now: AGORA, actor: { kind: 'member', userId: user.id, membershipId: membership.id, name: user.name, role: 'PROFESSIONAL' } },
      )
      const continuacao = await requestPasswordReset(user.email, { ip: `198.51.100.${i + 1}` }, AGORA)
      const r = await Promise.allSettled([
        resetPassword({ token, password: 'senha-nova-bem-longa' }, META, AGORA),
        continuacao(),
        changeOwnAccountPassword(euCtx, { current: 'senha-antiga-1', next: 'outra-nova-senha-1' }, 'x'),
        resetPassword({ token, password: 'senha-nova-bem-longa' }, META, AGORA),
        ...escalonar(10, 8, async () => (await requestPasswordReset(user.email, { ip: `192.0.2.${i + 1}` }, AGORA))()),
      ])
      expect(inesperados(r)).toEqual([])
      // No máximo um token vivo por pessoa, e a senha é a de quem passou.
      expect(await prisma.userToken.count({ where: { userId: user.id, purpose: 'PASSWORD_RESET', usedAt: null } })).toBeLessThanOrEqual(1)
      const mudou = [r[0], r[2], r[3]].some((x) => x?.status === 'fulfilled')
      expect(await senhaDe(user.id, 'senha-antiga-1')).toBe(!mudou)
    }
  })

  test('(c) desativar o último vínculo enquanto a redefinição está em andamento', async () => {
    for (let i = 0; i < RODADAS; i++) {
      const user = await makeUser({ password: 'senha-antiga-1' })
      const membership = await makeMembership(businessId, user.id, 'PROFESSIONAL')
      const token = randomUUID()
      await prisma.userToken.create({ data: { userId: user.id, purpose: 'PASSWORD_RESET', tokenHash: hashToken(token), expiresAt: addMinutes(AGORA, 60) } })
      const sessao = await prisma.session.create({
        data: { userId: user.id, activeBusinessId: businessId, tokenHash: hashToken(randomUUID()), expiresAt: addMinutes(AGORA, 600) },
      })
      const r = await Promise.allSettled([
        ...escalonar(10, 8, () => setAccessActive(dono, membership.id, false)),
        resetPassword({ token, password: 'senha-nova-bem-longa' }, META, AGORA),
      ])
      expect(inesperados(r)).toEqual([])
      expect(r[0].status).toBe('fulfilled')
      expect((await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } })).active).toBe(false)
      expect((await prisma.session.findUniqueOrThrow({ where: { id: sessao.id } })).revokedAt).not.toBeNull()
      expect(await senhaDe(user.id, 'senha-antiga-1')).toBe(r[10]?.status === 'rejected')
      expect(await prisma.userToken.count({ where: { userId: user.id, usedAt: null } })).toBe(0)
    }
  })

  test('dono enviando a redefinição a vários membros ao mesmo tempo, e dois donos desativando e redefinindo em cruz', async () => {
    const outro = await ctxWithRole({ id: businessId }, 'OWNER', { now: AGORA })
    for (let i = 0; i < RODADAS; i++) {
      const a = await membroComToken()
      const b = await membroComToken()
      const r = await Promise.allSettled([
        sendAccessPasswordReset(dono, a.membership.id),
        sendAccessPasswordReset(outro, b.membership.id),
        setAccessActive(outro, a.membership.id, false),
        setAccessActive(dono, b.membership.id, false),
        resetPassword({ token: a.token, password: 'senha-nova-bem-longa' }, META, AGORA),
        resetPassword({ token: b.token, password: 'senha-nova-bem-longa' }, META, AGORA),
      ])
      expect(inesperados(r)).toEqual([])
    }
    expect(memberOf(dono).membershipId).not.toBe(memberOf(outro).membershipId)
  })
})
