import { getPublicBrandById, getPublicBrandBySlug } from '@/server/domain/platform/branding'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { makeBusiness, makeUpload } from '../setup/factories'

beforeEach(resetDb)

const CHAVES_DA_MARCA = ['businessId', 'loginImageUrl', 'logoUrl', 'name', 'slug', 'symbolUrl', 'theme']

test('devolve o tema derivado das cores gravadas', async () => {
  const b = await makeBusiness({
    slug: 'pet',
    name: 'Pet',
    branding: {
      create: {
        displayName: 'Pet Bonito',
        primaryColor: '#2F6B4F',
        accentColor: '#E8833A',
        coverMaterial: 'LINEN',
      },
    },
  })
  const marca = await getPublicBrandBySlug('pet')
  expect(marca).not.toBeNull()
  expect(marca?.businessId).toBe(b.id)
  expect(marca?.name).toBe('Pet Bonito')
  expect(marca?.theme.material).toBe('linen')
  expect(marca?.theme.vars['--surface']).toBe('#FFFFFF')
  expect(marca?.theme.vars['--ground']).toMatch(/^#F[0-9A-F]{5}$/)
  expect(marca?.theme.vars['--ground']).not.toBe('#FFFFFF')
  expect((await getPublicBrandById(b.id))?.slug).toBe('pet')
})

test('slug inexistente e conta que não está ativa dão null', async () => {
  const s = await makeBusiness({ slug: 'suspensa', status: 'SUSPENDED' })
  const a = await makeBusiness({ slug: 'arquivada', status: 'ARCHIVED' })
  expect(await getPublicBrandBySlug('nao-existe')).toBeNull()
  expect(await getPublicBrandBySlug('suspensa')).toBeNull()
  expect(await getPublicBrandById(s.id)).toBeNull()
  expect(await getPublicBrandById(a.id)).toBeNull()
})

test('logoUrl é null sem upload e /arquivos/... com upload', async () => {
  const b = await makeBusiness({ slug: 'com-logo' })
  expect((await getPublicBrandBySlug('com-logo'))?.logoUrl).toBeNull()
  const logo = await makeUpload(b.id)
  const simbolo = await makeUpload(b.id)
  const capa = await makeUpload(b.id)
  await prisma.businessBranding.update({
    where: { businessId: b.id },
    data: { logoUploadId: logo.id, symbolUploadId: simbolo.id, loginImageUploadId: capa.id },
  })
  const marca = await getPublicBrandBySlug('com-logo')
  expect(marca?.logoUrl).toBe(`/arquivos/${logo.path}`)
  expect(marca?.symbolUrl).toBe(`/arquivos/${simbolo.path}`)
  expect(marca?.loginImageUrl).toBe(`/arquivos/${capa.path}`)
})

test('a marca pública só tem os campos declarados, sem dados internos da conta', async () => {
  await makeBusiness({
    slug: 'sigilo',
    document: '12.345.678/0001-90',
    email: 'contato@sigilo.test',
    phone: '11999990000',
  })
  const marca = await getPublicBrandBySlug('sigilo')
  expect(Object.keys(marca ?? {}).sort()).toEqual(CHAVES_DA_MARCA)
  const texto = JSON.stringify(marca)
  for (const segredo of ['12.345.678', 'contato@sigilo.test', '11999990000']) {
    expect(texto).not.toContain(segredo)
  }
})
