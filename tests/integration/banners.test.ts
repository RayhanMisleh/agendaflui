import sharp from 'sharp'
import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import {
  bannerLinkSchema,
  createBanner,
  deleteBanner,
  getBanner,
  listBanners,
  listLiveBanners,
  moveBanner,
  setBannerImage,
  updateBanner,
} from '@/server/domain/banners/banners'
import { getStorage } from '@/server/storage/storage'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeUpload } from '../setup/factories'

beforeEach(resetDb)

/** 23:30 de 24/12 em Manaus (UTC-4) e uma hora depois, já dia 25. */
const NOITE_24 = new Date('2026-12-25T03:30:00Z')
const MADRUGADA_25 = new Date('2026-12-25T04:30:00Z')
const HOJE = new Date('2026-12-10T15:00:00Z')

async function cena(o: { modulo?: boolean; now?: Date } = {}) {
  const b = await makeBusiness({ timezone: 'America/Manaus' })
  if (o.modulo !== false) await prisma.businessModules.update({ where: { businessId: b.id }, data: { banners: true } })
  const now = o.now ?? HOJE
  return {
    b,
    dono: await ctxWithRole(b, 'OWNER', { now }),
    gerente: await ctxWithRole(b, 'MANAGER', { now }),
    profissional: await ctxWithRole(b, 'PROFESSIONAL', { now }),
  }
}

const novo = (title: string, o: Partial<{ linkUrl: string | null; startsOn: string | null; endsOn: string | null; active: boolean }> = {}) => ({
  title,
  linkUrl: o.linkUrl ?? null,
  startsOn: o.startsOn ?? null,
  endsOn: o.endsOn ?? null,
  active: o.active ?? false,
})
const png = async (w = 800, h = 450) => ({ bytes: new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#0e4f5c' } }).png().toBuffer()) })

describe('link do banner', () => {
  test('aceita https, rota interna e vazio', () => {
    expect(bannerLinkSchema.parse('https://loja.exemplo/x')).toBe('https://loja.exemplo/x')
    expect(bannerLinkSchema.parse('/servicos')).toBe('/servicos')
    expect(bannerLinkSchema.parse('/loja/produtos_novos')).toBe('/loja/produtos_novos')
    expect(bannerLinkSchema.parse('')).toBeNull()
    expect(bannerLinkSchema.parse('   ')).toBeNull()
    expect(bannerLinkSchema.parse(null)).toBeNull()
  })

  test.each(['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/a/../b', 'ftp://x', 'mailto:a@b.c', 'http://loja.exemplo', 'HTTP://loja.exemplo/x', 'https://', 'servicos', '/a//b', '/'])(
    'recusa %s com a orientação',
    (link) => {
      const r = bannerLinkSchema.safeParse(link)
      expect(r.success).toBe(false)
      expect(r.error?.issues[0]?.message).toBe('Use um endereço que comece com https:// ou um caminho da loja, como /servicos')
    },
  )

  test('recusa mais de 500 caracteres', () => {
    expect(bannerLinkSchema.safeParse(`https://x.exemplo/${'a'.repeat(490)}`).success).toBe(false)
  })
})

describe('criar e editar', () => {
  test('nasce inativo, sem imagem e na próxima posição', async () => {
    const s = await cena()
    const a = await createBanner(s.dono, novo('  Natal  ', { linkUrl: '/servicos', startsOn: '2026-12-01', endsOn: '2026-12-24' }))
    const b = await createBanner(s.gerente, novo('Ano novo'))
    expect(a).toMatchObject({ title: 'Natal', linkUrl: '/servicos', startsOn: '2026-12-01', endsOn: '2026-12-24', active: false, imageUrl: null, displayOrder: 1 })
    expect(b.displayOrder).toBe(2)
    expect((await listBanners(s.dono)).map((x) => x.title)).toEqual(['Natal', 'Ano novo'])
    expect(await prisma.auditLog.count({ where: { businessId: s.b.id, action: 'banner.created' } })).toBe(2)
  })

  test('validação: título, link, datas e período invertido', async () => {
    const s = await cena()
    const tenta = (o: Record<string, unknown>) => domainError(createBanner(s.dono, { ...novo('X'), ...o } as never))
    expect((await tenta({ title: ' ' })).fields).toHaveProperty('title')
    expect((await tenta({ title: 'x'.repeat(81) })).fields).toHaveProperty('title')
    expect((await tenta({ linkUrl: 'javascript:alert(1)' })).fields).toHaveProperty('linkUrl')
    expect((await tenta({ startsOn: '2026-13-40' })).fields).toHaveProperty('startsOn')
    const periodo = await tenta({ startsOn: '2026-12-10', endsOn: '2026-12-09' })
    expect(periodo.code).toBe('validation')
    expect(periodo.fields).toHaveProperty('endsOn')
    expect(await prisma.banner.count()).toBe(0)
  })

  test('um único dia vale (início igual ao fim)', async () => {
    const s = await cena()
    expect((await createBanner(s.dono, novo('Hoje', { startsOn: '2026-12-10', endsOn: '2026-12-10' }))).endsOn).toBe('2026-12-10')
  })

  test('criar já ativo, ou ativar sem imagem, é validação; com imagem ativa', async () => {
    const s = await cena()
    expect((await domainError(createBanner(s.dono, novo('X', { active: true })))).fields).toHaveProperty('active')
    const b = await createBanner(s.dono, novo('Natal'))
    const erro = await domainError(updateBanner(s.dono, b.id, { active: true }))
    expect(erro.code).toBe('validation')
    expect(erro.fields).toHaveProperty('active')
    await setBannerImage(s.dono, b.id, await png())
    expect((await updateBanner(s.dono, b.id, { active: true })).active).toBe(true)
  })

  test('mudar só o período confere com o que já está gravado', async () => {
    const s = await cena()
    const b = await createBanner(s.dono, novo('Natal', { startsOn: '2026-12-10', endsOn: '2026-12-20' }))
    expect((await domainError(updateBanner(s.dono, b.id, { endsOn: '2026-12-01' }))).fields).toHaveProperty('endsOn')
    expect((await updateBanner(s.dono, b.id, { endsOn: null })).endsOn).toBeNull()
  })

  test('profissional e módulo desligado recusam; conta B por id em A é not_found', async () => {
    const s = await cena()
    expect((await domainError(createBanner(s.profissional, novo('X')))).code).toBe('forbidden')
    expect((await domainError(listBanners(s.profissional))).code).toBe('forbidden')
    const off = await cena({ modulo: false })
    expect((await domainError(listBanners(off.dono))).code).toBe('module_disabled')
    expect((await domainError(createBanner(off.dono, novo('X')))).code).toBe('module_disabled')
    expect((await domainError(listLiveBanners(off.dono))).code).toBe('module_disabled')
    const outro = await cena()
    const deB = await createBanner(outro.dono, novo('De B'))
    expect((await domainError(getBanner(s.dono, deB.id))).code).toBe('not_found')
    expect((await domainError(updateBanner(s.dono, deB.id, { title: 'x' }))).code).toBe('not_found')
    expect((await domainError(deleteBanner(s.dono, deB.id))).code).toBe('not_found')
    expect((await domainError(setBannerImage(s.dono, deB.id, null))).code).toBe('not_found')
    expect((await domainError(moveBanner(s.dono, deB.id, 'up'))).code).toBe('not_found')
    expect((await domainError(getBanner(s.dono, 'nao-uuid'))).code).toBe('not_found')
  })
})

describe('imagem', () => {
  test('troca apaga a antiga, remover desativa o banner e some o arquivo', async () => {
    const s = await cena()
    const b = await createBanner(s.dono, novo('Natal'))
    const a = await setBannerImage(s.dono, b.id, await png())
    expect(a.imageUrl).toMatch(/^\/arquivos\//)
    const primeira = await prisma.banner.findUniqueOrThrow({ where: { id: b.id }, include: { image: true } })
    await setBannerImage(s.dono, b.id, await png(900, 500))
    expect(await prisma.upload.findUnique({ where: { id: primeira.imageUploadId as string } })).toBeNull()
    expect(await getStorage().get(primeira.image?.path ?? 'x')).toBeNull()
    await updateBanner(s.dono, b.id, { active: true })
    const sem = await setBannerImage(s.dono, b.id, null)
    expect(sem).toMatchObject({ imageUrl: null, active: false })
    expect(await prisma.upload.count({ where: { businessId: s.b.id } })).toBe(0)
  })

  test('imagem pequena demais (lado menor abaixo de 400) e arquivo inválido são validação', async () => {
    const s = await cena()
    const b = await createBanner(s.dono, novo('Natal'))
    expect((await domainError(setBannerImage(s.dono, b.id, await png(300, 200)))).code).toBe('validation')
    expect((await domainError(setBannerImage(s.dono, b.id, { bytes: new Uint8Array([1, 2, 3]) }))).code).toBe('validation')
    expect((await domainError(setBannerImage(s.profissional, b.id, null))).code).toBe('forbidden')
  })

  test('a imagem é guardada em caixa 1920x1080, sem recorte', async () => {
    const s = await cena()
    const b = await createBanner(s.dono, novo('Natal'))
    await setBannerImage(s.dono, b.id, await png(3000, 1000))
    const up = await prisma.banner.findUniqueOrThrow({ where: { id: b.id }, include: { image: true } })
    expect(up.image).toMatchObject({ width: 1920, height: 640 })
  })
})

describe('no ar hoje', () => {
  async function ativo(s: Awaited<ReturnType<typeof cena>>, title: string, o: Parameters<typeof novo>[1] = {}) {
    const b = await createBanner(s.dono, novo(title, o))
    await setBannerImage(s.dono, b.id, await png())
    return updateBanner(s.dono, b.id, { active: true })
  }

  test('em Manaus, às 23:30 do dia 24 o banner que termina em 24 aparece; às 00:30 do dia 25 não', async () => {
    const s = await cena()
    await ativo(s, 'Natal', { endsOn: '2026-12-24' })
    const noite = await ctxWithRole(s.b, 'OWNER', { now: NOITE_24 })
    const madrugada = await ctxWithRole(s.b, 'OWNER', { now: MADRUGADA_25 })
    expect((await listLiveBanners(noite)).map((x) => x.title)).toEqual(['Natal'])
    expect(await listLiveBanners(madrugada)).toEqual([])
  })

  test('início no futuro, inativo e sem imagem ficam de fora; o selo de cada um é coerente', async () => {
    const s = await cena()
    await ativo(s, 'No ar')
    await ativo(s, 'Futuro', { startsOn: '2026-12-11' })
    await ativo(s, 'Passado', { endsOn: '2026-12-09' })
    const inativo = await createBanner(s.dono, novo('Inativo'))
    await setBannerImage(s.dono, inativo.id, await png())
    await createBanner(s.dono, novo('Sem imagem'))
    expect((await listLiveBanners(s.profissional)).map((x) => x.title)).toEqual(['No ar'])
    const por = Object.fromEntries((await listBanners(s.dono)).map((x) => [x.title, x]))
    expect(por['No ar']).toMatchObject({ status: 'live', showingToday: true })
    expect(por['Futuro']).toMatchObject({ status: 'scheduled', showingToday: false })
    expect(por['Passado']).toMatchObject({ status: 'ended', showingToday: false })
    expect(por['Inativo']).toMatchObject({ status: 'inactive', showingToday: false })
    expect(por['Sem imagem']).toMatchObject({ status: 'inactive', showingToday: false })
  })

  test('no máximo 20, em ordem, com o link e a imagem', async () => {
    const s = await cena()
    const up = await makeUpload(s.b.id)
    for (let i = 1; i <= 22; i++) {
      await prisma.banner.create({ data: { businessId: s.b.id, title: `B${String(i).padStart(2, '0')}`, imageUploadId: up.id, active: true, displayOrder: i, linkUrl: '/servicos' } })
    }
    const vivos = await listLiveBanners(s.dono)
    expect(vivos).toHaveLength(20)
    expect(vivos[0]).toMatchObject({ title: 'B01', linkUrl: '/servicos', imageUrl: expect.stringMatching(/^\/arquivos\//) })
    expect(vivos[19]?.title).toBe('B20')
  })
})

describe('ordem e exclusão', () => {
  test('sobe e desce trocando com o vizinho; nas pontas não faz nada', async () => {
    const s = await cena()
    const [a, b, c] = [await createBanner(s.dono, novo('A')), await createBanner(s.dono, novo('B')), await createBanner(s.dono, novo('C'))]
    await moveBanner(s.dono, c.id, 'up')
    expect((await listBanners(s.dono)).map((x) => x.title)).toEqual(['A', 'C', 'B'])
    await moveBanner(s.dono, a.id, 'up')
    await moveBanner(s.dono, b.id, 'down')
    expect((await listBanners(s.dono)).map((x) => x.title)).toEqual(['A', 'C', 'B'])
  })

  test('dois movimentos simultâneos terminam sem posição repetida', async () => {
    const s = await cena()
    const lista = []
    for (const t of ['A', 'B', 'C', 'D']) lista.push(await createBanner(s.dono, novo(t)))
    for (let rodada = 0; rodada < 4; rodada++) {
      await Promise.all([moveBanner(s.dono, lista[3]!.id, 'up'), moveBanner(s.dono, lista[0]!.id, 'down'), moveBanner(s.dono, lista[2]!.id, 'up')])
      const ordens = (await prisma.banner.findMany({ where: { businessId: s.b.id } })).map((x) => x.displayOrder).sort()
      expect(ordens).toEqual([1, 2, 3, 4])
    }
  })

  test('criar em paralelo também não repete posição', async () => {
    const s = await cena()
    await Promise.all(['A', 'B', 'C'].map((t) => createBanner(s.dono, novo(t))))
    expect((await prisma.banner.findMany({ where: { businessId: s.b.id } })).map((x) => x.displayOrder).sort()).toEqual([1, 2, 3])
  })

  test('ativar enquanto outra aba tira a imagem: nunca erro 500; ou ativa e a remoção desativa, ou é erro de campo', async () => {
    const s = await cena()
    for (let i = 0; i < 6; i++) {
      const b = await createBanner(s.dono, novo(`Corrida ${i}`))
      await setBannerImage(s.dono, b.id, await png())
      const [ativar, tirar] = await Promise.allSettled([updateBanner(s.dono, b.id, { active: true }), setBannerImage(s.dono, b.id, null)])
      expect(tirar.status).toBe('fulfilled')
      if (ativar.status === 'rejected') {
        expect(ativar.reason).toMatchObject({ code: 'validation', fields: { active: expect.any(String) } })
      }
      const linha = await prisma.banner.findUniqueOrThrow({ where: { id: b.id } })
      expect(linha.imageUploadId).toBeNull()
      expect(linha.active).toBe(false)
    }
  })

  test('excluir enquanto a imagem é trocada: sem arquivo nem registro de imagem órfão', async () => {
    const s = await cena()
    for (let i = 0; i < 6; i++) {
      const b = await createBanner(s.dono, novo(`Exclusão ${i}`))
      await setBannerImage(s.dono, b.id, await png())
      const [troca] = await Promise.allSettled([setBannerImage(s.dono, b.id, await png(900, 500)), deleteBanner(s.dono, b.id)])
      if (troca.status === 'rejected') expect(troca.reason).toMatchObject({ code: 'not_found' })
      expect(await prisma.banner.count({ where: { id: b.id } })).toBe(0)
      expect(await prisma.upload.count({ where: { businessId: s.b.id } })).toBe(0)
    }
  })

  test('excluir apaga a linha, o registro e o arquivo da imagem', async () => {
    const s = await cena()
    const b = await createBanner(s.dono, novo('Natal'))
    await setBannerImage(s.dono, b.id, await png())
    const linha = await prisma.banner.findUniqueOrThrow({ where: { id: b.id }, include: { image: true } })
    expect(await getStorage().get(linha.image?.path ?? 'x')).not.toBeNull()
    await deleteBanner(s.dono, b.id)
    expect(await prisma.banner.count()).toBe(0)
    expect(await prisma.upload.count({ where: { businessId: s.b.id } })).toBe(0)
    expect(await getStorage().get(linha.image?.path ?? 'x')).toBeNull()
    expect(await prisma.auditLog.count({ where: { businessId: s.b.id, action: 'banner.deleted' } })).toBe(1)
    expect((await domainError(deleteBanner(s.profissional, b.id))).code).toBe('forbidden')
  })
})
