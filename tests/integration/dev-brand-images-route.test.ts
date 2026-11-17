import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

const guards = vi.hoisted(() => ({ requirePlatformAdmin: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
const disco = vi.hoisted(() => ({ storage: null as import('@/server/storage/storage').Storage | null }))
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => disco.storage ?? real.getStorage() }
})

import * as rota from '@/app/dev/(app)/contas/[id]/imagens/[slot]/route'

const { POST } = rota
const OK = { host: 'dev.localhost:3000', origin: 'http://dev.localhost:3000' }

function pedido(id: string, slot: string, campos: Record<string, string | File>, headers: Record<string, string> = OK) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return [
    new Request(`http://dev.localhost:3000/contas/${id}/imagens/${slot}`, { method: 'POST', headers, body: fd }),
    { params: Promise.resolve({ id, slot }) },
  ] as const
}
const png = async (w = 64, h = 64) => new File([new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#0e4f5c' } }).png().toBuffer())], 'logo.png', { type: 'image/png' })

let dir: string
beforeAll(async () => {
  const { createLocalDiskStorage } = await import('@/server/storage/local-disk')
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-imagens-'))
  disco.storage = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  guards.requirePlatformAdmin.mockResolvedValue({ kind: 'platform_admin', adminId: admin.id, name: admin.name })
})
afterEach(() => guards.requirePlatformAdmin.mockReset())

const volta = (id: string, q: string) => `/contas/${id}/marca?imagem=${q}`

describe('envio de imagem da marca por rota própria (POST)', () => {
  test('a rota só aceita POST', () => {
    expect(Object.keys(rota)).toEqual(['POST'])
  })

  test('envia a imagem do slot e volta à aba Marca com ?imagem=ok (303, sem cache)', async () => {
    const conta = await makeBusiness()
    const r = await POST(...pedido(conta.id, 'logo', { file: await png() }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(volta(conta.id, 'ok'))
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })).logoUploadId).not.toBeNull()
  })

  test('remove com intent=remove', async () => {
    const conta = await makeBusiness()
    await POST(...pedido(conta.id, 'symbol', { file: await png() }))
    const r = await POST(...pedido(conta.id, 'symbol', { intent: 'remove' }))
    expect(r.headers.get('location')).toBe(volta(conta.id, 'ok'))
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: conta.id } })).symbolUploadId).toBeNull()
  })

  test('sem sessão de admin: recusado antes de tocar o domínio', async () => {
    const conta = await makeBusiness()
    guards.requirePlatformAdmin.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(POST(...pedido(conta.id, 'logo', { file: await png() }))).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.upload.count()).toBe(0)
  })

  test('origem de outro site (ou sem origem) é recusada com 403 e nada é gravado', async () => {
    const conta = await makeBusiness()
    const ruim = await POST(...pedido(conta.id, 'logo', { file: await png() }, { host: 'dev.localhost:3000', origin: 'https://site-ruim.example' }))
    expect(ruim.status).toBe(403)
    const sem = await POST(...pedido(conta.id, 'logo', { file: await png() }, { host: 'dev.localhost:3000' }))
    expect(sem.status).toBe(403)
    expect(await prisma.upload.count()).toBe(0)
  })

  test('arquivo acima de 8 MiB em bytes reais: erro claro, nada gravado', async () => {
    const conta = await makeBusiness()
    const grande = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })
    const r = await POST(...pedido(conta.id, 'logo', { file: grande }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(volta(conta.id, 'too_large'))
    expect(await prisma.upload.count()).toBe(0)
  })

  test('corpo declarado enorme é recusado sem ler', async () => {
    const conta = await makeBusiness()
    const [req, ctx] = pedido(conta.id, 'logo', { file: await png() }, { ...OK, 'content-length': String(50 * 1024 * 1024) })
    const r = await POST(req, ctx)
    expect(r.headers.get('location')).toBe(volta(conta.id, 'too_large'))
  })

  test('slot inválido, sem arquivo e arquivo que não é imagem voltam com o código do erro', async () => {
    const conta = await makeBusiness()
    expect((await POST(...pedido(conta.id, 'constructor', { file: await png() }))).headers.get('location')).toBe(volta(conta.id, 'invalid_slot'))
    expect((await POST(...pedido(conta.id, 'logo', {}))).headers.get('location')).toBe(volta(conta.id, 'no_file'))
    const texto = new File(['isto não é uma imagem'], 'x.png', { type: 'image/png' })
    expect((await POST(...pedido(conta.id, 'favicon', { file: texto }))).headers.get('location')).toBe(volta(conta.id, 'not_an_image'))
    expect(await prisma.upload.count()).toBe(0)
  })

  test('imagem pequena demais e conta que não existe', async () => {
    const conta = await makeBusiness()
    expect((await POST(...pedido(conta.id, 'symbol', { file: await png(4, 4) }))).headers.get('location')).toBe(volta(conta.id, 'too_small'))
    const fantasma = '11111111-1111-4111-8111-111111111111'
    const r = await POST(...pedido(fantasma, 'logo', { file: await png() }))
    expect(r.headers.get('location')).toBe(volta(fantasma, 'not_found'))
  })
})
