import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { createBanner } from '@/server/domain/banners/banners'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)

import * as rotaBanner from '@/app/painel/(app)/banners/[id]/imagem/route'
import * as rotaPremio from '@/app/painel/(app)/fidelidade/premios/[id]/imagem/route'

const OK = { host: 'painel.localhost:3000', origin: 'http://painel.localhost:3000' }
const png = async (w = 800, h = 450) => new File([new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#0e4f5c' } }).png().toBuffer())], 'i.png', { type: 'image/png' })

function pedido(base: string, id: string, campos: Record<string, string | File>, headers: Record<string, string> = OK) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return [new Request(`http://painel.localhost:3000${base}/${id}/imagem`, { method: 'POST', headers, body: fd }), { params: Promise.resolve({ id }) }] as const
}

let businessId: string
let bannerId: string
let premioId: string
beforeEach(async () => {
  await resetDb()
  const b = await makeBusiness()
  businessId = b.id
  await prisma.businessModules.update({ where: { businessId }, data: { banners: true, loyalty: true } })
  const dono = await ctxWithRole(b, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
  bannerId = (await createBanner(dono, { title: 'Natal', linkUrl: null, startsOn: null, endsOn: null, active: false })).id
  premioId = (await createPrize(dono, { name: 'Corte', description: null, costPoints: 10, stock: null, active: true })).id
})
afterEach(() => guards.requireTenant.mockReset())

const alvos = [
  { nome: 'banner', rota: rotaBanner, base: '/banners', volta: (id: string, c: string) => `/banners/${id}?imagem=${c}`, id: () => bannerId, coluna: async () => (await prisma.banner.findUniqueOrThrow({ where: { id: bannerId } })).imageUploadId },
  { nome: 'prêmio', rota: rotaPremio, base: '/fidelidade/premios', volta: (id: string, c: string) => `/fidelidade/premios/${id}?imagem=${c}`, id: () => premioId, coluna: async () => (await prisma.prize.findUniqueOrThrow({ where: { id: premioId } })).imageUploadId },
]

describe.each(alvos)('envio de imagem do $nome', ({ rota, base, volta, id, coluna }) => {
  test('a rota só aceita POST', () => {
    expect(Object.keys(rota)).toEqual(['POST'])
  })

  test('envia e volta à ficha com ?imagem=ok (303)', async () => {
    const r = await rota.POST(...pedido(base, id(), { file: await png() }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(volta(id(), 'ok'))
    expect(await coluna()).not.toBeNull()
  })

  test('remove com intent=remove', async () => {
    await rota.POST(...pedido(base, id(), { file: await png() }))
    const r = await rota.POST(...pedido(base, id(), { intent: 'remove' }))
    expect(r.headers.get('location')).toBe(volta(id(), 'ok'))
    expect(await coluna()).toBeNull()
    expect(await prisma.upload.count({ where: { businessId } })).toBe(0)
  })

  test('sem sessão: redireciona e não grava nada', async () => {
    guards.requireTenant.mockRejectedValue(new Error('NEXT_REDIRECT'))
    await expect(rota.POST(...pedido(base, id(), { file: await png() }))).rejects.toThrow('NEXT_REDIRECT')
    expect(await prisma.upload.count()).toBe(0)
  })

  test('origem de outro site ou sem origem: 403 e nada é gravado', async () => {
    const outras: Record<string, string>[] = [{ host: OK.host, origin: 'http://evil.example' }, { host: OK.host }]
    for (const headers of outras) {
      expect((await rota.POST(...pedido(base, id(), { file: await png() }, headers))).status).toBe(403)
    }
    expect(await prisma.upload.count()).toBe(0)
  })

  test('não é imagem, sem arquivo, grande demais e pequena demais voltam com o código', async () => {
    const codigo = async (campos: Record<string, string | File>) => (await rota.POST(...pedido(base, id(), campos))).headers.get('location')
    expect(await codigo({ file: new File(['oi'], 'x.txt', { type: 'text/plain' }) })).toBe(volta(id(), 'not_an_image'))
    expect(await codigo({})).toBe(volta(id(), 'no_file'))
    expect(await codigo({ file: new File([new Uint8Array(8 * 1024 * 1024 + 10)], 'g.png', { type: 'image/png' }) })).toBe(volta(id(), 'too_large'))
    if (base === '/banners') expect(await codigo({ file: await png(300, 200) })).toBe(volta(id(), 'too_small'))
  })

  test('profissional é recusado pelo domínio (refused) e id de outra conta é not_found', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    expect((await rota.POST(...pedido(base, id(), { file: await png() }))).headers.get('location')).toBe(volta(id(), 'refused'))
    const outra = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: outra.id }, data: { banners: true, loyalty: true } })
    guards.requireTenant.mockResolvedValue(await ctxWithRole(outra, 'OWNER'))
    expect((await rota.POST(...pedido(base, id(), { file: await png() }))).headers.get('location')).toBe(volta(id(), 'not_found'))
    expect(await prisma.upload.count()).toBe(0)
  })

  test('módulo desligado: recusado sem gravar', async () => {
    await prisma.businessModules.update({ where: { businessId }, data: { banners: false, loyalty: false } })
    const r = await rota.POST(...pedido(base, id(), { file: await png() }))
    expect(r.headers.get('location')).toBe(volta(id(), 'refused'))
    expect(await prisma.upload.count()).toBe(0)
  })
})
