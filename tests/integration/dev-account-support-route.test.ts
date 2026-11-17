import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
const suporte = vi.hoisted(() => ({ falhaTecnica: false }))
vi.mock('@/server/auth/support-session', async (original) => {
  const real = await original<typeof import('@/server/auth/support-session')>()
  return {
    ...real,
    startSupport: (...args: Parameters<typeof real.startSupport>) => {
      if (suporte.falhaTecnica) throw new TypeError('banco caiu; senha=hunter2')
      return real.startSupport(...args)
    },
  }
})

import * as rota from '@/app/dev/(app)/contas/[id]/entrar/route'

const { POST } = rota

const pedido = (id: string, headers: Record<string, string> = { host: 'dev.localhost:3000', origin: 'http://dev.localhost:3000' }) =>
  [new Request(`http://dev.localhost:3000/contas/${id}/entrar`, { method: 'POST', headers }), { params: Promise.resolve({ id }) }] as const

beforeEach(async () => {
  suporte.falhaTecnica = false
  await resetDb()
  const admin = await makePlatformAdmin()
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: admin.id, name: admin.name })
})
afterEach(() => guards.requirePlatformAdmin.mockReset())

describe('entrar como (POST)', () => {
  test('emite o link de passagem e redireciona para o painel da conta, sem guardar em cache', async () => {
    const conta = await makeBusiness()
    const r = await POST(...pedido(conta.id))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toMatch(/\/suporte\/[^/]+$/)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(await prisma.supportHandoff.count({ where: { businessId: conta.id } })).toBe(1)
  })

  test('conta arquivada volta à página da conta com o aviso, sem emitir link', async () => {
    const conta = await makeBusiness({ status: 'ARCHIVED' })
    const r = await POST(...pedido(conta.id))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/contas/${conta.id}?suporte=arquivada`)
    expect(await prisma.supportHandoff.count()).toBe(0)
  })

  test('formulário de outro site (origem diferente) é recusado e nada é emitido', async () => {
    const conta = await makeBusiness()
    const r = await POST(...pedido(conta.id, { host: 'dev.localhost:3000', origin: 'https://site-ruim.example' }))
    expect(r.status).toBe(403)
    expect(await prisma.supportHandoff.count()).toBe(0)
  })

  test('sem Origin o pedido é recusado e nada é emitido', async () => {
    const conta = await makeBusiness()
    const r = await POST(...pedido(conta.id, { host: 'dev.localhost:3000' }))
    expect(r.status).toBe(403)
    expect(await prisma.supportHandoff.count()).toBe(0)
  })

  test('sem sessão de admin a rota não emite nada', async () => {
    const conta = await makeBusiness()
    guards.requirePlatformAdmin.mockRejectedValue(new Error('sem sessão'))
    await expect(POST(...pedido(conta.id))).rejects.toThrow('sem sessão')
    expect(await prisma.supportHandoff.count()).toBe(0)
  })

  test('conta inexistente e id que não é UUID voltam com ?suporte=falhou, sem emitir nada', async () => {
    const inexistente = '7d1f3a52-3c1e-4f0a-9a54-0a9f4d6c2b11'
    const a = await POST(...pedido(inexistente))
    expect(a.status).toBe(303)
    expect(a.headers.get('location')).toBe(`/contas/${inexistente}?suporte=falhou`)
    const b = await POST(...pedido('nao-e-uuid'))
    expect(b.status).toBe(303)
    expect(b.headers.get('location')).toBe('/contas/nao-e-uuid?suporte=falhou')
    expect(await prisma.supportHandoff.count()).toBe(0)
  })

  test('erro que não é de domínio vira ?suporte=falhou (não 500) e só o NOME do erro vai para o log', async () => {
    const conta = await makeBusiness()
    suporte.falhaTecnica = true
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await POST(...pedido(conta.id))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/contas/${conta.id}?suporte=falhou`)
    const texto = JSON.stringify(log.mock.calls)
    expect(texto).toContain('TypeError')
    expect(texto).not.toContain('hunter2')
    log.mockRestore()
  })

  test('a rota não exporta GET: só POST existe', async () => {
    expect('GET' in rota).toBe(false)
    expect(Object.keys(rota)).toEqual(['POST'])
  })
})
