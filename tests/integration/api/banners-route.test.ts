import sharp from 'sharp'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as listarBanners } from '@/app/api/v1/banners/route'
import { prisma } from '@/server/db/client'
import { createBanner, setBannerImage, updateBanner } from '@/server/domain/banners/banners'
import { apiError, apiRequest, callRoute, jsonObject } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx } from '../../setup/factories'

vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena

const png = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 800, height: 450, channels: 3, background: '#0e4f5c' } }).png().toBuffer()) })

beforeEach(async () => {
  await resetDb()
  c = await montarCena()
  await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { banners: true } })
})

const get = (token?: string, key: string | null = c.key) => callRoute(listarBanners, apiRequest('GET', '/v1/banners', { ...(key ? { key } : {}), ...(token ? { token } : {}) }))

async function noAr(business: { id: string }, title: string, link: string | null = null) {
  const dono = await makeCtx(business)
  const b = await createBanner(dono, { title, linkUrl: link, startsOn: null, endsOn: null, active: false })
  await setBannerImage(dono, b.id, await png())
  await updateBanner(dono, b.id, { active: true })
  return b
}

describe('GET /v1/banners', () => {
  test('lista só os banners no ar, com título, imagem absoluta e link, sem chave nem login de cliente', async () => {
    await noAr(c.business, 'Natal', '/servicos')
    const dono = await makeCtx(c.business)
    await createBanner(dono, { title: 'Rascunho', linkUrl: null, startsOn: null, endsOn: null, active: false })
    const r = await get()
    expect(r.status).toBe(200)
    const itens = jsonObject(r.json).items as Record<string, unknown>[]
    expect(itens).toHaveLength(1)
    expect(itens[0]).toMatchObject({ title: 'Natal', linkUrl: '/servicos' })
    expect(String(itens[0]?.imageUrl).startsWith('http')).toBe(true)
    expect(Object.keys(itens[0] ?? {}).sort()).toEqual(['id', 'imageUrl', 'linkUrl', 'title'])
  })

  test('com login de cliente também responde', async () => {
    await noAr(c.business, 'Natal')
    expect((await get(c.tokenCliente)).status).toBe(200)
  })

  test('exige a chave do app', async () => {
    expect((await get(undefined, null)).status).toBe(401)
  })

  test('banner de outra conta não aparece', async () => {
    const outra = await montarCena()
    await prisma.businessModules.update({ where: { businessId: outra.business.id }, data: { banners: true } })
    await noAr(outra.business, 'Da outra')
    expect(jsonObject((await get()).json).items).toEqual([])
  })

  test('módulo desligado: 404 module_disabled', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { banners: false } })
    const r = await get()
    expect(r.status).toBe(404)
    expect(apiError(r.json).code).toBe('module_disabled')
  })
})
