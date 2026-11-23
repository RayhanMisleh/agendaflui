import { beforeEach, expect, test, vi } from 'vitest'
import { clearRateLimit, hitRateLimit, LIMITS, limitKey, PURGE_AFTER_SEC, purgeRateLimits } from '@/server/auth/rate-limit-db'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'

const T0 = new Date('2026-11-20T12:00:00.000Z')
const em = (seg: number): Date => new Date(T0.getTime() + seg * 1000)
const regra = { limit: 5, windowSec: 900 }

beforeEach(resetDb)

test('5 acertos passam e o 6º é negado com a espera entre 1 e 900 s', async () => {
  for (let i = 1; i <= 5; i++) {
    const r = await hitRateLimit('k', regra, T0)
    expect(r).toEqual({ allowed: true, remaining: 5 - i, retryAfterSec: 0 })
  }
  const negado = await hitRateLimit('k', regra, em(60))
  expect(negado.allowed).toBe(false)
  expect(negado.remaining).toBe(0)
  expect(negado.retryAfterSec).toBe(840)
  expect(negado.retryAfterSec).toBeGreaterThanOrEqual(1)
  expect(negado.retryAfterSec).toBeLessThanOrEqual(900)
})

test('a espera arredonda para cima e nunca passa a janela', async () => {
  for (let i = 0; i < 5; i++) await hitRateLimit('k', regra, T0)
  expect((await hitRateLimit('k', regra, em(899.2))).retryAfterSec).toBe(1)
})

test('depois da janela volta a permitir e abre janela nova', async () => {
  for (let i = 0; i < 6; i++) await hitRateLimit('k', regra, T0)
  expect((await hitRateLimit('k', regra, em(899))).allowed).toBe(false)
  const r = await hitRateLimit('k', regra, em(900))
  expect(r).toEqual({ allowed: true, remaining: 4, retryAfterSec: 0 })
  const linha = await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'k' } })
  expect(linha.count).toBe(1)
  expect(linha.windowStart.getTime()).toBe(em(900).getTime())
})

test('30 chamadas em paralelo com limite 10 permitem exatamente 10', async () => {
  const rs = await Promise.all(Array.from({ length: 30 }, () => hitRateLimit('paralelo', { limit: 10, windowSec: 60 }, T0)))
  expect(rs.filter((r) => r.allowed)).toHaveLength(10)
  expect(rs.filter((r) => !r.allowed)).toHaveLength(20)
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'paralelo' } })).count).toBeLessThanOrEqual(11)
})

test('chaves diferentes não interferem', async () => {
  for (let i = 0; i < 6; i++) await hitRateLimit('a', regra, T0)
  expect((await hitRateLimit('a', regra, T0)).allowed).toBe(false)
  expect((await hitRateLimit('b', regra, T0)).allowed).toBe(true)
})

test('o estado está no banco: um processo novo (módulo recarregado) enxerga a contagem', async () => {
  for (let i = 0; i < 5; i++) await hitRateLimit('persiste', regra, T0)
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'persiste' } })).count).toBe(5)
  vi.resetModules()
  const novo = await import('@/server/auth/rate-limit-db')
  expect(novo.hitRateLimit).not.toBe(hitRateLimit)
  expect((await novo.hitRateLimit('persiste', regra, em(1))).allowed).toBe(false)
})

test('clearRateLimit zera só a chave pedida', async () => {
  for (let i = 0; i < 6; i++) await hitRateLimit('a', regra, T0)
  await hitRateLimit('b', regra, T0)
  await clearRateLimit('a')
  expect((await hitRateLimit('a', regra, T0)).remaining).toBe(4)
  expect(await prisma.rateLimitBucket.findUnique({ where: { key: 'b' } })).not.toBeNull()
  await expect(clearRateLimit('nunca-existiu')).resolves.toBeUndefined()
})

test('purgeRateLimits apaga só as janelas que começaram há mais de 1 dia e devolve quantas', async () => {
  expect(PURGE_AFTER_SEC).toBe(86400)
  await hitRateLimit('velha', regra, em(-25 * 3600))
  await hitRateLimit('quase', regra, em(-23 * 3600))
  await hitRateLimit('nova', regra, T0)
  expect(await purgeRateLimits(T0)).toBe(1)
  expect((await prisma.rateLimitBucket.findMany({ orderBy: { key: 'asc' } })).map((l) => l.key)).toEqual(['nova', 'quase'])
  expect(await purgeRateLimits(T0)).toBe(0)
})

test('a espera nunca passa da janela, mesmo com relógio atrasado em relação ao gravado', async () => {
  for (let i = 0; i < 6; i++) await hitRateLimit('relogio', regra, T0)
  const r = await hitRateLimit('relogio', regra, em(-60))
  expect(r.allowed).toBe(false)
  expect(r.retryAfterSec).toBe(regra.windowSec)
})

test('regra inválida é erro de programação', async () => {
  const ruim = [
    { limit: 0, windowSec: 60 },
    { limit: 1.5, windowSec: 60 },
    { limit: 5, windowSec: 0 },
    { limit: 5, windowSec: 86401 },
    { limit: 5, windowSec: 1.5 },
    { limit: Number.NaN, windowSec: 60 },
  ]
  for (const r of ruim) await expect(hitRateLimit('k', r, T0), JSON.stringify(r)).rejects.toThrow(/regra/i)
  await expect(hitRateLimit('k', { limit: 1, windowSec: 86400 }, T0)).resolves.toBeDefined()
})

test('a contagem para de crescer acima do limite', async () => {
  for (let i = 0; i < 50; i++) await hitRateLimit('teto', regra, T0)
  expect((await prisma.rateLimitBucket.findUniqueOrThrow({ where: { key: 'teto' } })).count).toBe(6)
})

test('chave com mais de 200 caracteres é recusada; limitKey encurta com hash estável', async () => {
  await expect(hitRateLimit('x'.repeat(201), regra, T0)).rejects.toThrow(/200/)
  await expect(hitRateLimit('x'.repeat(200), regra, T0)).resolves.toBeDefined()
  expect(limitKey('login:painel:email', 'a@b.test')).toBe('login:painel:email:a@b.test')
  const longa = limitKey('login:painel:email', `${'a'.repeat(300)}@b.test`)
  expect(longa.length).toBeLessThanOrEqual(200)
  expect(longa).toBe(limitKey('login:painel:email', `${'a'.repeat(300)}@b.test`))
  expect(longa).not.toBe(limitKey('login:painel:email', `${'b'.repeat(300)}@b.test`))
})

test('os limites combinados', () => {
  expect(LIMITS).toEqual({
    loginEmail: { limit: 5, windowSec: 900 },
    loginEmailIp: { limit: 5, windowSec: 900 },
    loginEmailWide: { limit: 30, windowSec: 900 },
    loginIp: { limit: 20, windowSec: 900 },
    apiIp: { limit: 120, windowSec: 60 },
    authIp: { limit: 30, windowSec: 900 },
    panelResetIp: { limit: 10, windowSec: 900 },
    codeEmail: { limit: 3, windowSec: 900 },
    codeEmailDaily: { limit: 6, windowSec: 86400 },
    codeFailures: { limit: 10, windowSec: 86400 },
    booking: { limit: 20, windowSec: 60 },
    redeem: { limit: 10, windowSec: 60 },
    postalCode: { limit: 30, windowSec: 60 },
    shippingQuote: { limit: 20, windowSec: 60 },
    order: { limit: 10, windowSec: 60 },
    webhookIp: { limit: 120, windowSec: 60 },
    webhookIpTotal: { limit: 600, windowSec: 60 },
    availability: { limit: 60, windowSec: 60 },
  })
})
