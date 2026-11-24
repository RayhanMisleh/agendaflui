import { beforeEach, describe, expect, test, vi } from 'vitest'
import { beginGoogle, failureTarget, handleGoogleCallback } from '@/server/auth/google/callback'
import type { GoogleIntent } from '@/server/auth/google/flow'
import { readGoogleFlow } from '@/server/auth/google/flow'
import { issueInvite } from '@/server/auth/invites'
import { getPersonSession } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { clearGoogleSettings, getGoogleSettings, saveGoogleSettings } from '@/server/domain/platform/google-settings'
import { fakeGoogleAuthority } from '@/server/integrations/fakes'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'

const quiz = vi.hoisted(() => ({ needs: vi.fn(async () => false) }))
vi.mock('@/server/auth/pet-onboarding', () => ({ needsPetQuiz: quiz.needs }))

const ID = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const SEGREDO = 'GOCSPX-abcdef0123456789Qz7K'
const AGORA = new Date('2026-11-23T15:00:00.000Z')
const google = fakeGoogleAuthority()

let slug: string
let businessId: string

beforeEach(async () => {
  await resetDb()
  quiz.needs.mockReset()
  quiz.needs.mockResolvedValue(false)
  google.reset()
  const a = await makePlatformAdmin()
  await saveGoogleSettings({ kind: 'platform_admin', adminId: a.id, name: a.name }, { clientId: ID, clientSecret: SEGREDO }, 0, AGORA)
  const b = await makeBusiness({ slug: 'pet-bom' })
  slug = b.slug
  businessId = b.id
})

type Conta = { sub: string; email: string; name?: string; email_verified?: boolean }

/** Faz o fluxo inteiro: começa, o "Google" emite o código com a identidade e o retorno é tratado. */
async function percorrer(
  intent: GoogleIntent,
  conta: Conta,
  o: { sessionToken?: string; ip?: string; now?: Date; state?: (s: string) => string; cookie?: (c: string) => string | undefined; nonce?: string } = {},
) {
  const now = o.now ?? AGORA
  const inicio = await beginGoogle(intent, undefined, now)
  if (!('url' in inicio)) throw new Error(`sem início: ${inicio.failure}`)
  const fluxo = await readGoogleFlow(inicio.cookie, now)
  if (!fluxo) throw new Error('fluxo ilegível')
  const code = await google.issueCode({ ...conta, nonce: o.nonce ?? fluxo.nonce })
  return handleGoogleCallback({
    code,
    state: o.state ? o.state(fluxo.state) : fluxo.state,
    error: null,
    flowCookie: o.cookie ? o.cookie(inicio.cookie) : inicio.cookie,
    sessionToken: o.sessionToken,
    ...(o.ip ? { ip: o.ip } : {}),
    userAgent: 'teste',
    now,
  })
}

const GA = { sub: 'g-ana', email: 'ana@exemplo.test', name: 'Ana Souza' }

describe('regra 1: Google vinculado', () => {
  test('entra, atualiza google_email e não muda a pessoa', async () => {
    const dona = await makeUser({ email: 'ana@exemplo.test', google: { sub: 'g-ana', email: 'ana@exemplo.test' } })
    // O e-mail da conta Google passou a ser o de outra pessoa; o vínculo (sub) é o que vale.
    const outra = await makeUser({ email: 'novo@exemplo.test' })
    const r = await percorrer({ kind: 'sign_in' }, { sub: 'g-ana', email: 'novo@exemplo.test' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = await getPersonSession(r.session?.token, AGORA)
    expect(s?.kind === 'person' && s.user.id).toBe(dona.id)
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: dona.id } })
    expect(depois.googleEmail).toBe('novo@exemplo.test')
    expect(depois.email).toBe('ana@exemplo.test')
    expect(depois.googleSub).toBe('g-ana')
    const intacta = await prisma.user.findUniqueOrThrow({ where: { id: outra.id } })
    expect(intacta.googleSub).toBeNull()
    expect(await prisma.user.count()).toBe(2)
  })
})

describe('regra 2', () => {
  test('recusa com account_exists e não cria pessoa', async () => {
    const ativa = await makeUser({ email: 'ana@exemplo.test' })
    const r = await percorrer({ kind: 'sign_in' }, GA)
    expect(r).toMatchObject({ ok: false, failure: 'account_exists', redirectTo: '/entrar?google=account_exists' })
    expect(await prisma.user.count()).toBe(1)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ativa.id } })).googleSub).toBeNull()
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('regra 2b', () => {
  test('vincula a conta pendente, verifica, consome os convites e abre sessão', async () => {
    const pendente = await makeUser({ email: 'ana@exemplo.test', password: null })
    await prisma.$transaction((tx) => issueInvite(tx, pendente.id, AGORA))
    const r = await percorrer({ kind: 'sign_in' }, GA)
    expect(r.ok).toBe(true)
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: pendente.id } })
    expect(depois.googleSub).toBe('g-ana')
    expect(depois.emailVerifiedAt).not.toBeNull()
    expect(depois.passwordHash).toBeNull()
    expect(await prisma.userToken.count({ where: { userId: pendente.id, purpose: 'INVITE', usedAt: null } })).toBe(0)
    expect(await prisma.session.count({ where: { userId: pendente.id, revokedAt: null } })).toBe(1)
    expect(await prisma.user.count()).toBe(1)
  })
})

describe('regra 3: convite', () => {
  test('aceito pelo Google: vínculo feito, convite consumido, destino /painel', async () => {
    const convidada = await makeUser({ email: 'ana@exemplo.test', password: null })
    await makeMembership(businessId, convidada.id, 'MANAGER')
    const { token } = await prisma.$transaction((tx) => issueInvite(tx, convidada.id, AGORA))
    const r = await percorrer({ kind: 'invite', token }, GA)
    expect(r).toMatchObject({ ok: true, redirectTo: '/painel' })
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: convidada.id } })
    expect(depois.googleSub).toBe('g-ana')
    expect(depois.emailVerifiedAt).not.toBeNull()
    expect(await prisma.userToken.count({ where: { userId: convidada.id, purpose: 'INVITE', usedAt: null } })).toBe(0)
  })

  test('outro e-mail, Google de outra pessoa e convite usado são recusados', async () => {
    const convidada = await makeUser({ email: 'ana@exemplo.test', password: null })
    const { token } = await prisma.$transaction((tx) => issueInvite(tx, convidada.id, AGORA))
    expect(await percorrer({ kind: 'invite', token }, { sub: 'g-x', email: 'outra@exemplo.test' })).toMatchObject({ ok: false, failure: 'email_mismatch' })
    await makeUser({ email: 'dono@exemplo.test', google: { sub: 'g-ana', email: 'dono@exemplo.test' } })
    const taken = await percorrer({ kind: 'invite', token }, GA)
    expect(taken).toMatchObject({ ok: false, failure: 'google_taken' })
    expect(taken.redirectTo).toBe(`/convite/${token}?google=google_taken`)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: convidada.id } })).googleSub).toBeNull()
    expect(await prisma.userToken.count({ where: { userId: convidada.id, usedAt: null } })).toBe(1)
    await prisma.userToken.updateMany({ where: { userId: convidada.id }, data: { usedAt: AGORA } })
    expect(await percorrer({ kind: 'invite', token }, { sub: 'g-y', email: 'ana@exemplo.test' })).toMatchObject({ ok: false, failure: 'invite_invalid' })
  })
})

describe('regra 4: cliente novo pela loja', () => {
  test('cria pessoa verificada e vinculada e o cliente da loja; adota o balcão com o mesmo e-mail', async () => {
    const balcao = await makeCustomer(businessId, { name: 'Ana do Balcão', email: 'ana@exemplo.test' })
    const r = await percorrer({ kind: 'store_signup', slug }, GA)
    expect(r).toMatchObject({ ok: true, redirectTo: `/${slug}` })
    const pessoa = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@exemplo.test' } })
    expect(pessoa).toMatchObject({ googleSub: 'g-ana', googleEmail: 'ana@exemplo.test', name: 'Ana Souza', passwordHash: null })
    expect(pessoa.emailVerifiedAt).not.toBeNull()
    const clientes = await prisma.customer.findMany({ where: { businessId } })
    expect(clientes).toHaveLength(1)
    expect(clientes[0]).toMatchObject({ id: balcao.id, userId: pessoa.id, name: 'Ana do Balcão' })
    const sessao = await prisma.session.findFirstOrThrow({ where: { userId: pessoa.id } })
    expect(sessao.customerBusinessId).toBe(businessId)
  })

  test('store_signup com back: cliente novo cai no quiz com volta; back inválido é descartado no início do fluxo', async () => {
    quiz.needs.mockResolvedValue(true)
    const r = await percorrer({ kind: 'store_signup', slug, back: `/${slug}/agendar` }, GA)
    expect(r).toMatchObject({ ok: true, redirectTo: `/${slug}/boas-vindas?volta=${encodeURIComponent(`/${slug}/agendar`)}` })
    quiz.needs.mockResolvedValue(false)
    const volta = await percorrer({ kind: 'store_signup', slug, back: `/${slug}/agendar` }, GA)
    expect(volta).toMatchObject({ ok: true, redirectTo: `/${slug}/agendar` })
    for (const ruim of ['/outra/agendar', 'https://x.test/', `//${slug}`]) {
      const inicio = await beginGoogle({ kind: 'store_signup', slug, back: ruim }, undefined, AGORA)
      if (!('url' in inicio)) throw new Error('sem início')
      expect((await readGoogleFlow(inicio.cookie, AGORA))?.intent).toEqual({ kind: 'store_signup', slug })
    }
  })

  test('sem balcão, cria o cliente da loja; loja fechada recusa sem criar pessoa', async () => {
    expect((await percorrer({ kind: 'store_signup', slug }, GA)).ok).toBe(true)
    expect(await prisma.customer.count({ where: { businessId, user: { email: 'ana@exemplo.test' } } })).toBe(1)
    await resetDbPessoas()
    await prisma.business.update({ where: { id: businessId }, data: { status: 'SUSPENDED' } })
    const r = await percorrer({ kind: 'store_signup', slug }, { sub: 'g-b', email: 'b@exemplo.test' })
    expect(r).toMatchObject({ ok: false, failure: 'store_unavailable', redirectTo: `/${slug}/entrar?google=store_unavailable` })
    expect(await prisma.user.count({ where: { email: 'b@exemplo.test' } })).toBe(0)
  })

  test('pela loja, conta ativa com o e-mail é recusada e Google vinculado entra e vira cliente da loja', async () => {
    await makeUser({ email: 'ana@exemplo.test' })
    expect(await percorrer({ kind: 'store_signup', slug }, GA)).toMatchObject({ ok: false, failure: 'account_exists' })
    const dona = await makeUser({ email: 'bia@exemplo.test', google: { sub: 'g-bia', email: 'bia@exemplo.test' } })
    const r = await percorrer({ kind: 'store_signup', slug }, { sub: 'g-bia', email: 'bia@exemplo.test' })
    expect(r).toMatchObject({ ok: true, redirectTo: `/${slug}` })
    expect(await prisma.customer.count({ where: { businessId, userId: dona.id } })).toBe(1)
  })
})

async function resetDbPessoas(): Promise<void> {
  await prisma.session.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.user.deleteMany()
}

describe('regra 5', () => {
  test('nada criado; destino /entrar?google=unknown_google', async () => {
    const r = await percorrer({ kind: 'sign_in' }, GA)
    expect(r).toMatchObject({ ok: false, failure: 'unknown_google', redirectTo: '/entrar?google=unknown_google' })
    expect(await prisma.user.count()).toBe(0)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('regra 6: vincular', () => {
  async function entrada(email: string, o: { password?: string | null } = {}) {
    const u = await makeUser({ email, ...o })
    const sessao = await prisma.$transaction((tx) => import('@/server/auth/session').then((m) => m.openSession(tx, { userId: u.id, now: AGORA })))
    return { u, token: sessao.token }
  }

  test('vincula na pessoa da sessão; destino /conta?google=vinculado; sem sessão nova', async () => {
    const { u, token } = await entrada('ana@exemplo.test')
    const antes = await prisma.session.count()
    const r = await percorrer({ kind: 'link' }, GA, { sessionToken: token })
    expect(r).toEqual({ ok: true, session: null, redirectTo: '/conta?google=vinculado' })
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    expect(depois).toMatchObject({ googleSub: 'g-ana', googleEmail: 'ana@exemplo.test' })
    expect(depois.googleLinkedAt).not.toBeNull()
    expect(await prisma.session.count()).toBe(antes)
  })

  test('recusas: sem sessão, outro e-mail, Google de outra pessoa e quem já tem Google', async () => {
    const { u, token } = await entrada('ana@exemplo.test')
    expect(await percorrer({ kind: 'link' }, GA)).toMatchObject({ ok: false, failure: 'not_signed_in', redirectTo: '/conta?google=not_signed_in' })
    expect(await percorrer({ kind: 'link' }, { sub: 'g-x', email: 'outra@exemplo.test' }, { sessionToken: token })).toMatchObject({ ok: false, failure: 'email_mismatch' })
    await makeUser({ email: 'dono@exemplo.test', google: { sub: 'g-ana', email: 'dono@exemplo.test' } })
    expect(await percorrer({ kind: 'link' }, GA, { sessionToken: token })).toMatchObject({ ok: false, failure: 'google_taken' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub).toBeNull()
    const { token: t2 } = await entrada('lia@exemplo.test')
    await prisma.user.update({ where: { email: 'lia@exemplo.test' }, data: { googleSub: 'g-lia', googleEmail: 'lia@exemplo.test', googleLinkedAt: AGORA } })
    expect(await percorrer({ kind: 'link' }, { sub: 'g-lia2', email: 'lia@exemplo.test' }, { sessionToken: t2 })).toMatchObject({ ok: false, failure: 'already_linked' })
  })
})

describe('regra 10 e 11', () => {
  test('regra 10: e-mail não verificado não cria, não vincula e não entra', async () => {
    const nv = { ...GA, email_verified: false }
    expect(await percorrer({ kind: 'store_signup', slug }, nv)).toMatchObject({ ok: false, failure: 'email_not_verified' })
    expect(await prisma.user.count()).toBe(0)
    const pendente = await makeUser({ email: 'ana@exemplo.test', password: null })
    expect(await percorrer({ kind: 'sign_in' }, nv)).toMatchObject({ ok: false, failure: 'email_not_verified' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pendente.id } })).googleSub).toBeNull()
    const dona = await makeUser({ email: 'bia@exemplo.test', google: { sub: 'g-bia', email: 'bia@exemplo.test' } })
    expect(await percorrer({ kind: 'sign_in' }, { sub: 'g-bia', email: 'bia@exemplo.test', email_verified: false })).toMatchObject({ ok: false, failure: 'email_not_verified' })
    expect(await prisma.session.count({ where: { userId: dona.id } })).toBe(0)
    const { u, token } = await (async () => {
      const x = await makeUser({ email: 'cia@exemplo.test' })
      const s = await prisma.$transaction((tx) => import('@/server/auth/session').then((m) => m.openSession(tx, { userId: x.id, now: AGORA })))
      return { u: x, token: s.token }
    })()
    expect(await percorrer({ kind: 'link' }, { sub: 'g-c', email: 'cia@exemplo.test', email_verified: false }, { sessionToken: token })).toMatchObject({ ok: false, failure: 'email_not_verified' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).googleSub).toBeNull()
  })

  test('regra 11: sem chaves, beginGoogle devolve not_configured', async () => {
    const a = await makePlatformAdmin()
    const v = await getGoogleSettings({ kind: 'platform_admin', adminId: a.id, name: a.name })
    await clearGoogleSettings({ kind: 'platform_admin', adminId: a.id, name: a.name }, v.version, AGORA)
    expect(await beginGoogle({ kind: 'sign_in' }, undefined, AGORA)).toEqual({ failure: 'not_configured' })
  })
})

describe('invariantes e segurança do fluxo', () => {
  test('dois retornos simultâneos do mesmo Google novo criam uma pessoa só', async () => {
    const preparar = async () => {
      const inicio = await beginGoogle({ kind: 'store_signup', slug }, undefined, AGORA)
      if (!('url' in inicio)) throw new Error('sem início')
      const fluxo = await readGoogleFlow(inicio.cookie, AGORA)
      const code = await google.issueCode({ ...GA, nonce: fluxo?.nonce ?? '' })
      return { code, state: fluxo?.state ?? '', cookie: inicio.cookie }
    }
    const [a, b] = [await preparar(), await preparar()]
    const chamar = (x: typeof a) => handleGoogleCallback({ code: x.code, state: x.state, error: null, flowCookie: x.cookie, sessionToken: undefined, now: AGORA })
    const [ra, rb] = await Promise.all([chamar(a), chamar(b)])
    expect(ra.ok).toBe(true)
    expect(rb.ok).toBe(true)
    expect(await prisma.user.count({ where: { email: 'ana@exemplo.test' } })).toBe(1)
    expect(await prisma.customer.count({ where: { businessId } })).toBe(1)
    expect(await prisma.session.count()).toBe(2)
  })

  test('invariante: no vínculo o e-mail verificado do Google é igual ao da pessoa', async () => {
    const todos = [
      await percorrer({ kind: 'store_signup', slug }, GA),
      await (async () => {
        const u = await makeUser({ email: 'bia@exemplo.test', password: null })
        await makeMembership(businessId, u.id, 'MANAGER')
        const { token } = await prisma.$transaction((tx) => issueInvite(tx, u.id, AGORA))
        return percorrer({ kind: 'invite', token }, { sub: 'g-bia', email: 'bia@exemplo.test' })
      })(),
      await (async () => {
        await makeUser({ email: 'cia@exemplo.test', password: null })
        return percorrer({ kind: 'sign_in' }, { sub: 'g-cia', email: 'cia@exemplo.test' })
      })(),
    ]
    expect(todos.every((r) => r.ok)).toBe(true)
    const vinculados = await prisma.user.findMany({ where: { googleSub: { not: null } } })
    expect(vinculados).toHaveLength(3)
    for (const u of vinculados) expect(u.googleEmail).toBe(u.email)
  })

  test('state diferente, cookie vencido ou ausente: flow_invalid; o mesmo código não serve duas vezes', async () => {
    expect(await percorrer({ kind: 'sign_in' }, GA, { state: () => 'outro-state-qualquer-0000' })).toMatchObject({ ok: false, failure: 'flow_invalid' })
    expect(await percorrer({ kind: 'sign_in' }, GA, { cookie: () => undefined })).toMatchObject({ ok: false, failure: 'flow_invalid', redirectTo: '/entrar?google=flow_invalid' })
    const inicio = await beginGoogle({ kind: 'sign_in' }, undefined, AGORA)
    if (!('url' in inicio)) throw new Error('sem início')
    const fluxo = await readGoogleFlow(inicio.cookie, AGORA)
    const code = await google.issueCode({ ...GA, nonce: fluxo?.nonce ?? '' })
    const tarde = new Date(AGORA.getTime() + 11 * 60 * 1000)
    expect(await handleGoogleCallback({ code, state: fluxo?.state ?? null, error: null, flowCookie: inicio.cookie, sessionToken: undefined, now: tarde })).toMatchObject({ ok: false, failure: 'flow_invalid' })
    // Uso único: depois de trocado, o código não vale de novo.
    await makeUser({ email: 'ana@exemplo.test', google: { sub: 'g-ana', email: 'ana@exemplo.test' } })
    const ok = await handleGoogleCallback({ code, state: fluxo?.state ?? null, error: null, flowCookie: inicio.cookie, sessionToken: undefined, now: AGORA })
    expect(ok.ok).toBe(true)
    const outraVez = await handleGoogleCallback({ code, state: fluxo?.state ?? null, error: null, flowCookie: inicio.cookie, sessionToken: undefined, now: AGORA })
    expect(outraVez.ok).toBe(false)
  })

  test('id_token com nonce de outro fluxo: flow_invalid', async () => {
    await makeUser({ email: 'ana@exemplo.test', google: { sub: 'g-ana', email: 'ana@exemplo.test' } })
    const r = await percorrer({ kind: 'sign_in' }, GA, { nonce: 'nonce-de-outro-fluxo-000000' })
    expect(r).toMatchObject({ ok: false, failure: 'flow_invalid' })
    expect(await prisma.session.count()).toBe(0)
  })

  test('error=access_denied: canceled', async () => {
    const inicio = await beginGoogle({ kind: 'store_signup', slug }, undefined, AGORA)
    if (!('url' in inicio)) throw new Error('sem início')
    const fluxo = await readGoogleFlow(inicio.cookie, AGORA)
    const r = await handleGoogleCallback({ code: null, state: fluxo?.state ?? null, error: 'access_denied', flowCookie: inicio.cookie, sessionToken: undefined, now: AGORA })
    expect(r).toMatchObject({ ok: false, failure: 'canceled', redirectTo: `/${slug}/entrar?google=canceled` })
    const outro = await handleGoogleCallback({ code: null, state: fluxo?.state ?? null, error: 'server_error', flowCookie: inicio.cookie, sessionToken: undefined, now: AGORA })
    expect(outro).toMatchObject({ ok: false, failure: 'provider_error' })
  })

  test('21ª tentativa do mesmo IP em 15 minutos: rate_limited', async () => {
    let ultimo: Awaited<ReturnType<typeof handleGoogleCallback>> | null = null
    for (let n = 1; n <= 21; n++) {
      ultimo = await handleGoogleCallback({ code: 'x', state: 'y', error: null, flowCookie: undefined, sessionToken: undefined, ip: '203.0.113.50', now: AGORA })
      if (n <= 20) expect(ultimo).toMatchObject({ ok: false, failure: 'flow_invalid' })
    }
    expect(ultimo).toMatchObject({ ok: false, failure: 'rate_limited' })
  })

  test('beginGoogle limita por IP', async () => {
    let r: Awaited<ReturnType<typeof beginGoogle>> | null = null
    for (let n = 1; n <= 31; n++) r = await beginGoogle({ kind: 'sign_in' }, '203.0.113.51', AGORA)
    expect(r).toEqual({ failure: 'rate_limited' })
  })

  test('failureTarget por intenção', () => {
    expect(failureTarget(null, 'canceled')).toBe('/entrar?google=canceled')
    expect(failureTarget({ kind: 'link' }, 'canceled')).toBe('/conta?google=canceled')
    expect(failureTarget({ kind: 'invite', token: 'abc' }, 'canceled')).toBe('/convite/abc?google=canceled')
    expect(failureTarget({ kind: 'store_signup', slug: 'x' }, 'canceled')).toBe('/x/entrar?google=canceled')
  })
})
