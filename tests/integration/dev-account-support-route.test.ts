import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)

import * as rota from '@/app/dev/(app)/contas/[id]/entrar/route'

const { POST } = rota

const pedido = (id: string, headers: Record<string, string> = { host: 'dev.localhost:3000', origin: 'http://dev.localhost:3000' }) =>
  [new Request(`http://dev.localhost:3000/contas/${id}/entrar`, { method: 'POST', headers }), { params: Promise.resolve({ id }) }] as const

beforeEach(async () => {
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

  test('GET não tem efeito: a rota só aceita POST', async () => {
    expect(Object.keys(rota)).toEqual(['POST'])
  })
})
