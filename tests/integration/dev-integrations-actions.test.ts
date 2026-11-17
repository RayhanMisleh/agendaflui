import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { removerFrenet, removerMercadoPago, salvarFrenet, salvarMercadoPago } from '@/app/dev/(app)/contas/[id]/integracoes/actions'
import { getIntegrations } from '@/server/domain/platform/integrations'
import { readFrenetToken, readMercadoPagoSecrets } from '@/server/domain/platform/integration-secrets'
import type { FormState } from '@/app/_lib/form-state'

const TOKEN = 'TEST-a1b2c3d4e5f6g7h8i9j0-Qz7K'
const SEGREDO = 'whsecabcdef0123456789Hy5N'
const FRENET = 'FRENET-TOKEN-0123456789-Vb6D'

const ini = { ok: false, message: null, fields: {}, values: {} } as FormState<Record<string, string>> as never

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let adminAtual: { adminId: string; name: string }
let conta: Awaited<ReturnType<typeof makeBusiness>>

beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  adminAtual = { adminId: admin.id, name: admin.name }
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', ...adminAtual })
  conta = await makeBusiness()
})
afterEach(() => {
  guards.requirePlatformAdmin.mockReset()
})

/** O estado devolvido não pode trazer segredo algum, nem nos valores, nem nas mensagens. */
function semSegredo(estado: unknown, ...proibidos: string[]): void {
  const json = JSON.stringify(estado)
  for (const p of proibidos) expect(json).not.toContain(p)
  const valores = (estado as { values: Record<string, string> }).values
  for (const nome of ['accessToken', 'webhookSecret', 'token']) expect(valores).not.toHaveProperty(nome)
}

describe('Mercado Pago', () => {
  test('token inválido: erro no campo, valores sem os segredos, nada gravado', async () => {
    const r = await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: 'token-ruim', webhookSecret: SEGREDO }))
    expect(r.ok).toBe(false)
    expect(r.fields).toHaveProperty('accessToken')
    semSegredo(r, 'token-ruim', SEGREDO)
    expect(r.values.version).toBe('0')
    expect(await prisma.businessIntegration.count()).toBe(0)
  })

  test('na primeira vez só com o token: erro no campo do segredo do webhook', async () => {
    const r = await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: TOKEN, webhookSecret: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields).toHaveProperty('webhookSecret')
    semSegredo(r, TOKEN)
  })

  test('salva, devolve só a versão nova e nunca o segredo', async () => {
    const r = await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: TOKEN, webhookSecret: SEGREDO }))
    expect(r.ok).toBe(true)
    expect(r.message).toBeTruthy()
    expect(r.values.version).toBe('1')
    semSegredo(r, TOKEN, SEGREDO, 'Qz7K', 'Hy5N')
    expect(await readMercadoPagoSecrets(conta.id)).toEqual({ accessToken: TOKEN, webhookSecret: SEGREDO })
  })

  test('campo em branco mantém o que já está gravado', async () => {
    await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: TOKEN, webhookSecret: SEGREDO }))
    const r = await salvarMercadoPago(conta.id, ini, form({ version: '1', accessToken: '', webhookSecret: 'whsecuvwxyz9876543210Jm2R' }))
    expect(r.ok).toBe(true)
    expect((await readMercadoPagoSecrets(conta.id))?.accessToken).toBe(TOKEN)
  })

  test('formulário todo em branco: erro e nada muda', async () => {
    const r = await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: '', webhookSecret: '' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
  })

  test('versão antiga: aviso de conflito e nada gravado', async () => {
    await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: TOKEN, webhookSecret: SEGREDO }))
    const r = await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: 'APP_USR-k9l8m7n6o5p4q3r2s1t0-Wx3P', webhookSecret: SEGREDO }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Outra pessoa alterou/)
    semSegredo(r, 'Wx3P', TOKEN)
    expect((await readMercadoPagoSecrets(conta.id))?.accessToken).toBe(TOKEN)
  })

  test('remover apaga os segredos', async () => {
    await salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: TOKEN, webhookSecret: SEGREDO }))
    const r = await removerMercadoPago(conta.id, ini, form({ version: '1' }))
    expect(r.ok).toBe(true)
    expect((await getIntegrations({ kind: 'platform_admin', ...adminAtual }, conta.id)).mercadoPago.configured).toBe(false)
  })

  test('sem admin a ação recusa antes de ler o formulário e nada é gravado', async () => {
    guards.requirePlatformAdmin.mockRejectedValue(new Error('sem sessão'))
    await expect(salvarMercadoPago(conta.id, ini, form({ version: '0', accessToken: TOKEN, webhookSecret: SEGREDO }))).rejects.toThrow('sem sessão')
    expect(await prisma.businessIntegration.count()).toBe(0)
  })

  test('sem admin nenhum campo do formulário é lido (nem os segredos)', async () => {
    guards.requirePlatformAdmin.mockRejectedValue(new Error('sem sessão'))
    const fd = form({ version: '0', accessToken: TOKEN, webhookSecret: SEGREDO, token: FRENET })
    const lidos: string[] = []
    const original = fd.get.bind(fd)
    fd.get = (nome: string) => {
      lidos.push(nome)
      return original(nome)
    }
    for (const acao of [salvarMercadoPago, salvarFrenet, removerMercadoPago, removerFrenet]) {
      await expect(acao(conta.id, ini, fd)).rejects.toThrow('sem sessão')
    }
    expect(lidos).toEqual([])
  })

  test('a conta vem do id ligado, nunca do formulário', async () => {
    const outra = await makeBusiness()
    await salvarMercadoPago(conta.id, ini, form({ version: '0', businessId: outra.id, accessToken: TOKEN, webhookSecret: SEGREDO }))
    expect(await readMercadoPagoSecrets(outra.id)).toBeNull()
    expect(await readMercadoPagoSecrets(conta.id)).not.toBeNull()
  })
})

describe('Frenet', () => {
  test('token inválido: erro de campo e valores sem o token', async () => {
    const r = await salvarFrenet(conta.id, ini, form({ version: '0', token: 'curto' }))
    expect(r.ok).toBe(false)
    expect(r.fields).toHaveProperty('token')
    semSegredo(r, 'curto')
  })

  test('salva e remove', async () => {
    const r = await salvarFrenet(conta.id, ini, form({ version: '0', token: FRENET }))
    expect(r.ok).toBe(true)
    expect(r.values.version).toBe('1')
    semSegredo(r, FRENET, 'Vb6D')
    expect(await readFrenetToken(conta.id)).toBe(FRENET)
    const rem = await removerFrenet(conta.id, ini, form({ version: '1' }))
    expect(rem.ok).toBe(true)
    expect(await readFrenetToken(conta.id)).toBeNull()
  })
})
