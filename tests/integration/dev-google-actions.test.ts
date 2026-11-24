import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetDb } from '../setup/db'
import { makePlatformAdmin } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { removerGoogle, salvarGoogle } from '@/app/dev/(app)/sistema/google/actions'
import { getGoogleSettings, isGoogleConfigured } from '@/server/domain/platform/google-settings'

const ID = '123456789012-abcdef0123456789.apps.googleusercontent.com'
const SEGREDO = 'GOCSPX-abcdef0123456789Qz7K'
const ini = { ok: false, message: null, fields: {}, values: {} } as never

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

beforeEach(async () => {
  await resetDb()
  const a = await makePlatformAdmin()
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: a.id, name: a.name })
})
afterEach(() => guards.requirePlatformAdmin.mockReset())

describe('ações da tela Google', () => {
  test('salvar e remover; a chave secreta nunca volta no estado', async () => {
    const r = await salvarGoogle(ini, form({ version: '0', clientId: ID, clientSecret: SEGREDO }))
    expect(r.ok).toBe(true)
    expect(JSON.stringify(r)).not.toContain(SEGREDO)
    expect(await isGoogleConfigured()).toBe(true)
    const v = (await getGoogleSettings({ kind: 'platform_admin', adminId: 'x', name: 'x' })).version
    const rem = await removerGoogle(ini, form({ version: String(v), clientId: ID }))
    expect(rem.ok).toBe(true)
    expect(await isGoogleConfigured()).toBe(false)
  })

  test('chave inválida: erro no campo e sem eco do valor', async () => {
    const r = await salvarGoogle(ini, form({ version: '0', clientId: ID, clientSecret: 'curta' }))
    expect(r.ok).toBe(false)
    expect(r.fields.clientSecret).toBeTruthy()
    expect(JSON.stringify(r)).not.toContain('curta')
  })

  test('versão velha: conflito com a mensagem da tela', async () => {
    await salvarGoogle(ini, form({ version: '0', clientId: ID, clientSecret: SEGREDO }))
    const r = await salvarGoogle(ini, form({ version: '0', clientId: ID, clientSecret: SEGREDO }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('Recarregue')
  })
})
