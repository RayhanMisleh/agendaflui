import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { createBanner, setBannerImage } from '@/server/domain/banners/banners'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})

import { alternarBanner, criarBanner, excluirBanner, moverBanner, salvarBanner } from '@/app/painel/(app)/banners/actions'
import BannersPage from '@/app/painel/(app)/banners/page'
import BannerPage from '@/app/painel/(app)/banners/[id]/page'
import NovoBannerPage from '@/app/painel/(app)/banners/novo/page'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}
const png = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 800, height: 450, channels: 3, background: '#0e4f5c' } }).png().toBuffer()) })

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  businessId = b.id
  await prisma.businessModules.update({ where: { businessId }, data: { banners: true } })
  dono = await ctxWithRole(b, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
})
afterEach(() => guards.requireTenant.mockReset())

const banners = () => prisma.banner.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } })
const CAMPOS = { title: 'Natal', linkUrl: '', startsOn: '', endsOn: '' }

describe('criar e salvar', () => {
  test('criar grava inativo e leva à ficha do banner', async () => {
    await expect(criarBanner(ini, form({ ...CAMPOS, linkUrl: '/servicos', startsOn: '2026-12-01', endsOn: '2026-12-24' }))).rejects.toThrow(/NEXT_REDIRECT \/banners\//)
    const [b] = await banners()
    expect(b).toMatchObject({ title: 'Natal', linkUrl: '/servicos', active: false, imageUploadId: null })
  })

  test('link perigoso volta como erro no campo, com o digitado, e nada é gravado', async () => {
    const r = await criarBanner(ini, form({ ...CAMPOS, linkUrl: 'javascript:alert(1)' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toEqual(['linkUrl'])
    expect(r.fields.linkUrl).toBe('Use um endereço que comece com https:// ou uma rota do app, como /servicos')
    expect(r.values.linkUrl).toBe('javascript:alert(1)')
    expect(await banners()).toHaveLength(0)
  })

  test('período invertido aponta o campo da data final', async () => {
    const r = await criarBanner(ini, form({ ...CAMPOS, startsOn: '2026-12-10', endsOn: '2026-12-01' }))
    expect(Object.keys(r.fields)).toEqual(['endsOn'])
  })

  test('salvar edita título, link e período; ativar sem imagem erra no campo active', async () => {
    const b = await createBanner(dono, { title: 'Natal', linkUrl: null, startsOn: null, endsOn: null, active: false })
    const r = await salvarBanner(ini, form({ ...CAMPOS, id: b.id, title: 'Natal 2026', linkUrl: 'https://loja.exemplo/x', active: 'on' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toEqual(['active'])
    const ok = await salvarBanner(ini, form({ ...CAMPOS, id: b.id, title: 'Natal 2026', linkUrl: 'https://loja.exemplo/x' }))
    expect(ok.ok).toBe(true)
    expect((await banners())[0]).toMatchObject({ title: 'Natal 2026', linkUrl: 'https://loja.exemplo/x', active: false })
  })

  test('profissional chamando direto recebe "sem permissão" e nada é gravado', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    const r = await criarBanner(ini, form(CAMPOS))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(NEGADO)
    expect(await banners()).toHaveLength(0)
  })

  test('módulo desligado: a ação recusa e nada é gravado', async () => {
    await prisma.businessModules.update({ where: { businessId }, data: { banners: false } })
    const r = await criarBanner(ini, form(CAMPOS))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Banners/)
    expect(await banners()).toHaveLength(0)
  })
})

describe('ativar, mover e excluir', () => {
  test('ativar e desativar pela lista', async () => {
    const b = await createBanner(dono, { title: 'A', linkUrl: null, startsOn: null, endsOn: null, active: false })
    expect((await alternarBanner(ini, form({ id: b.id, active: '1' }))).ok).toBe(false)
    await setBannerImage(dono, b.id, await png())
    expect((await alternarBanner(ini, form({ id: b.id, active: '1' }))).ok).toBe(true)
    expect((await banners())[0]?.active).toBe(true)
    await alternarBanner(ini, form({ id: b.id, active: '0' }))
    expect((await banners())[0]?.active).toBe(false)
  })

  test('mover troca a ordem', async () => {
    const a = await createBanner(dono, { title: 'A', linkUrl: null, startsOn: null, endsOn: null, active: false })
    await createBanner(dono, { title: 'B', linkUrl: null, startsOn: null, endsOn: null, active: false })
    await moverBanner(ini, form({ id: a.id, direction: 'down' }))
    expect((await banners()).map((x) => x.title)).toEqual(['B', 'A'])
  })

  test('excluir apaga o banner e a imagem', async () => {
    const b = await createBanner(dono, { title: 'A', linkUrl: null, startsOn: null, endsOn: null, active: false })
    await setBannerImage(dono, b.id, await png())
    expect((await excluirBanner(ini, form({ id: b.id }))).ok).toBe(true)
    expect(await banners()).toHaveLength(0)
    expect(await prisma.upload.count({ where: { businessId } })).toBe(0)
  })
})

describe('páginas', () => {
  const q = Promise.resolve({})
  test('com o módulo desligado cada página responde 404', async () => {
    await prisma.businessModules.update({ where: { businessId }, data: { banners: false } })
    const b = await prisma.banner.create({ data: { businessId, title: 'A' } })
    const nao = { digest: expect.stringContaining('404') }
    await expect(BannersPage({ searchParams: q })).rejects.toMatchObject(nao)
    await expect(NovoBannerPage()).rejects.toMatchObject(nao)
    await expect(BannerPage({ params: Promise.resolve({ id: b.id }), searchParams: q })).rejects.toMatchObject(nao)
  })
})
