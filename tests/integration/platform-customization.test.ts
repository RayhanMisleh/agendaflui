import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { getBusinessDetail } from '@/server/domain/platform/businesses'
import {
  getCustomization,
  setBrandImage,
  updateBrand,
  updateModules,
  updateNotificationsAsAdmin,
  updateRulesAsAdmin,
  updateTerms,
  type BrandInput,
} from '@/server/domain/platform/customization'
import { getPublicBrandById } from '@/server/domain/platform/branding'
import { getNotificationSettings } from '@/server/domain/settings/notification-settings'
import { getSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { createLocalDiskStorage } from '@/server/storage/local-disk'
import type { Storage } from '@/server/storage/storage'
import { previewTheme } from '@/shared/theme/preview'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCustomer,
  makePlatformAdmin,
  makeProfessional,
  makeService,
} from '../setup/factories'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

let dir: string
let disco: Storage
// O armazenamento que o domínio enxerga passa por aqui para os testes poderem provocar falhas.
let falhaAoApagar: ((chave: string) => boolean) | null = null
const armazenamento: Storage = {
  put: (k, d, t) => disco.put(k, d, t),
  get: (k) => disco.get(k),
  delete: async (k) => {
    if (falhaAoApagar?.(k)) throw new Error('disco recusou apagar')
    await disco.delete(k)
  },
}
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => armazenamento }
})

let actor: PlatformAdminActor
let biz: Awaited<ReturnType<typeof makeBusiness>>

const brand: BrandInput = {
  displayName: 'Barbearia Central',
  primary: '#7A1F2B',
  accent: '#F2A93B',
  material: 'WOOD',
  paper: 'GRAY',
  fontPair: 'MODERN',
  loginMessage: 'Bem-vindo de volta.',
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#0e4f5c' } }).png().toBuffer()
const imagem = async (w: number, h: number) => ({ bytes: new Uint8Array(await png(w, h)), mime: 'image/png' })

async function arquivosNoDisco(): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true })
  return entradas.filter((e) => e.isFile() && !e.name.endsWith('.meta')).map((e) => e.name)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-custom-'))
  disco = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await resetDb()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  falhaAoApagar = null
  const admin = await makePlatformAdmin()
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  biz = await makeBusiness()
})
afterEach(() => {
  vi.restoreAllMocks()
})

const auditoria = (action: string) =>
  prisma.auditLog.findMany({ where: { businessId: biz.id, action }, orderBy: { createdAt: 'asc' } })

describe('quem pode chamar', () => {
  test('só admin da plataforma: membro, suporte, sistema e ator ausente recebem forbidden em toda função', async () => {
    const dono = (await ctxWithRole(biz, 'OWNER')).actor
    const atores = [
      dono,
      { kind: 'impersonator', adminId: actor.adminId, name: 'x' },
      { kind: 'system' },
      { kind: 'guest' },
      undefined,
    ] as unknown as PlatformAdminActor[]
    for (const a of atores) {
      const chamadas = [
        () => getCustomization(a, biz.id),
        () => updateBrand(a, biz.id, 1, brand),
        () => setBrandImage(a, biz.id, 'logo', null),
        () => updateTerms(a, biz.id, termos),
        () => updateModules(a, biz.id, { loyalty: false, banners: false, store: false, vouchers: false }),
        () => updateRulesAsAdmin(a, biz.id, { bufferMin: 5 }),
        () => updateNotificationsAsAdmin(a, biz.id, avisosVazios),
      ]
      for (const chamar of chamadas) expect((await domainError(chamar())).code).toBe('forbidden')
    }
    expect(await prisma.auditLog.count({ where: { businessId: biz.id } })).toBe(0)
  })
})

const termos = {
  professionalSingular: 'Tosador',
  professionalPlural: 'Tosadores',
  customerSingular: 'Tutor',
  customerPlural: 'Tutores',
  pointsSingular: 'Patinha',
  pointsPlural: 'Patinhas',
  club: 'Clube Pet',
}
const avisosVazios = {} as Parameters<typeof updateNotificationsAsAdmin>[2]

describe('getCustomization', () => {
  test('devolve marca, termos, módulos, regras, fuso e avisos da conta', async () => {
    const r = await getCustomization(actor, biz.id)
    expect(r.brand).toMatchObject({
      displayName: `Conta ${biz.slug}`,
      primary: '#0B6E66',
      accent: '#F2A93B',
      material: 'LEATHER',
      paper: 'CREAM',
      fontPair: 'CLASSIC',
      loginMessage: null,
      logoUrl: null,
      symbolUrl: null,
      faviconUrl: null,
      loginImageUrl: null,
      version: 1,
    })
    expect(r.terms).toEqual({
      professionalSingular: 'Profissional',
      professionalPlural: 'Profissionais',
      customerSingular: 'Cliente',
      customerPlural: 'Clientes',
      pointsSingular: 'Ponto',
      pointsPlural: 'Pontos',
      club: 'Clube',
    })
    expect(r.modules).toEqual({ loyalty: false, banners: false, store: false, vouchers: false })
    expect(r.rules).toMatchObject({ slotStepMin: 15, minLeadMin: 60, autoConfirm: true })
    expect(r.timeZone).toBe('America/Sao_Paulo')
    expect(r.notifications.APPOINTMENT_CONFIRMED).toEqual({ email: true, push: true })
  })

  test('conta suspensa ou arquivada também abre; conta inexistente é not_found', async () => {
    for (const status of ['SUSPENDED', 'ARCHIVED'] as const) {
      const b = await makeBusiness({ status })
      expect((await getCustomization(actor, b.id)).timeZone).toBe('America/Sao_Paulo')
    }
    expect((await domainError(getCustomization(actor, '00000000-0000-4000-8000-000000000000'))).code).toBe('not_found')
    expect((await domainError(getCustomization(actor, 'nao-e-uuid'))).code).toBe('not_found')
  })
})

describe('updateBrand', () => {
  test('grava, normaliza as cores em maiúsculas (#RRGGBB), sobe a versão e audita os campos', async () => {
    const r = await updateBrand(actor, biz.id, 1, { ...brand, primary: '#7a1f2b', accent: '#f2a93b' })
    expect(r).toMatchObject({ ...brand, primary: '#7A1F2B', accent: '#F2A93B', version: 2 })
    const linha = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: biz.id } })
    expect([linha.primaryColor, linha.coverMaterial, linha.paperTone, linha.fontPair]).toEqual(['#7A1F2B', 'WOOD', 'GRAY', 'MODERN'])
    const [log] = await auditoria('brand.updated')
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: actor.adminId, onBehalf: false })
    // Só o que mudou, com antes e depois (o destaque só mudou de caixa, então não entra); a mensagem não vai por extenso.
    expect(log?.metadata).toEqual({
      changes: {
        displayName: { from: `Conta ${biz.slug}`, to: 'Barbearia Central' },
        primary: { from: '#0B6E66', to: '#7A1F2B' },
        material: { from: 'LEATHER', to: 'WOOD' },
        paper: { from: 'CREAM', to: 'GRAY' },
        fontPair: { from: 'CLASSIC', to: 'MODERN' },
      },
      loginMessageChanged: true,
    })
    expect(JSON.stringify(log?.metadata)).not.toContain('Bem-vindo')
  })

  test('gravar sem mudar nada não cria auditoria nem sobe a versão e devolve a marca atual', async () => {
    await updateBrand(actor, biz.id, 1, brand)
    const r = await updateBrand(actor, biz.id, 2, { ...brand, primary: '#7a1f2b' })
    expect(r).toMatchObject({ ...brand, version: 2 })
    expect(await auditoria('brand.updated')).toHaveLength(1)
    expect((await getCustomization(actor, biz.id)).brand.version).toBe(2)
  })

  test('só a mensagem mudou: a auditoria diz que mudou, sem o texto', async () => {
    await updateBrand(actor, biz.id, 1, brand)
    await updateBrand(actor, biz.id, 2, { ...brand, loginMessage: 'Texto novo secreto' })
    const logs = await auditoria('brand.updated')
    expect(logs[1]?.metadata).toEqual({ changes: {}, loginMessageChanged: true })
  })

  test('caracteres de controle e < > em texto são recusados; quebra de linha só na mensagem', async () => {
    const casos: [Partial<BrandInput>, string][] = [
      [{ displayName: 'Nome\u0000' }, 'displayName'],
      [{ displayName: 'Nome\nlinha' }, 'displayName'],
      [{ displayName: 'Nome\u200b' }, 'displayName'],
      [{ loginMessage: 'oi\u0007' }, 'loginMessage'],
      [{ loginMessage: 'oi <b>' }, 'loginMessage'],
      [{ loginMessage: 'oi > você' }, 'loginMessage'],
    ]
    for (const [troca, campo] of casos) {
      const e = await domainError(updateBrand(actor, biz.id, 1, { ...brand, ...troca }))
      expect(e.code, campo).toBe('validation')
      expect(Object.keys(e.fields ?? {}), campo).toContain(campo)
    }
    const r = await updateBrand(actor, biz.id, 1, { ...brand, loginMessage: 'Linha um\nLinha dois' })
    expect(r.loginMessage).toBe('Linha um\nLinha dois')
  })

  test('o painel da conta serve exatamente os tokens da prévia', async () => {
    await updateBrand(actor, biz.id, 1, brand)
    const servida = await getPublicBrandById(biz.id)
    const previa = previewTheme(brand)
    expect(servida?.theme.vars).toEqual(previa.tokens)
    expect(servida?.theme.warnings).toHaveLength(previa.warnings.length)
  })

  test.each([
    ['#FFF', 'primary'],
    ['red', 'primary'],
    ['#12345', 'primary'],
    ['#gggggg', 'primary'],
    ['', 'primary'],
    ['#FFF', 'accent'],
    ['red', 'accent'],
  ])('cor %s em %s é recusada com o campo no erro e nada muda', async (cor, campo) => {
    const e = await domainError(updateBrand(actor, biz.id, 1, { ...brand, [campo]: cor }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toContain(campo)
    const linha = await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: biz.id } })
    expect(linha.version).toBe(1)
    expect(linha.primaryColor).toBe('#0B6E66')
  })

  test('par de fontes, material e papel fora da lista, nome vazio e mensagem longa são recusados', async () => {
    const casos: [Partial<Record<keyof BrandInput, unknown>>, string][] = [
      [{ fontPair: 'COMIC' }, 'fontPair'],
      [{ material: 'PLASTIC' }, 'material'],
      [{ paper: 'BLACK' }, 'paper'],
      [{ displayName: '  ' }, 'displayName'],
      [{ displayName: 'A<b>' }, 'displayName'],
      [{ loginMessage: 'x'.repeat(281) }, 'loginMessage'],
    ]
    for (const [troca, campo] of casos) {
      const e = await domainError(updateBrand(actor, biz.id, 1, { ...brand, ...troca } as BrandInput))
      expect(e.code, campo).toBe('validation')
      expect(Object.keys(e.fields ?? {}), campo).toContain(campo)
    }
  })

  test('mensagem vazia vira null', async () => {
    const r = await updateBrand(actor, biz.id, 1, { ...brand, loginMessage: '   ' })
    expect(r.loginMessage).toBeNull()
  })

  test('versão antiga: conflict com stale_version, sem sobrescrever', async () => {
    await updateBrand(actor, biz.id, 1, brand)
    const e = await domainError(updateBrand(actor, biz.id, 1, { ...brand, displayName: 'Outro nome' }))
    expect(e).toMatchObject({ code: 'conflict', reason: 'stale_version' })
    expect((await getCustomization(actor, biz.id)).brand.displayName).toBe('Barbearia Central')
  })

  test('dois admins gravando sobre a mesma versão: um grava, o outro recebe conflito', async () => {
    const resultados = await Promise.allSettled([
      updateBrand(actor, biz.id, 1, { ...brand, displayName: 'A' }),
      updateBrand(actor, biz.id, 1, { ...brand, displayName: 'B' }),
    ])
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejeitada = resultados.find((r) => r.status === 'rejected')
    expect(rejeitada?.status === 'rejected' && rejeitada.reason).toMatchObject({ code: 'conflict', reason: 'stale_version' })
    expect((await getCustomization(actor, biz.id)).brand.version).toBe(2)
  })

  test('conta sem marca ou inexistente: not_found', async () => {
    expect((await domainError(updateBrand(actor, '00000000-0000-4000-8000-000000000000', 1, brand))).code).toBe('not_found')
  })

  test('cor extrema (branco) é aceita: o ajuste é do motor, não um erro', async () => {
    const r = await updateBrand(actor, biz.id, 1, { ...brand, primary: '#ffffff' })
    expect(r.primary).toBe('#FFFFFF')
    expect(previewTheme({ ...brand, primary: '#ffffff' }).warnings).toContain('text_adjusted')
  })
})

describe('updateTerms', () => {
  test('grava os sete termos e audita', async () => {
    expect(await updateTerms(actor, biz.id, termos)).toEqual(termos)
    expect((await getCustomization(actor, biz.id)).terms).toEqual(termos)
    const [log] = await auditoria('terms.updated')
    expect(log?.metadata).toEqual({
      changes: {
        professionalSingular: { from: 'Profissional', to: 'Tosador' },
        professionalPlural: { from: 'Profissionais', to: 'Tosadores' },
        customerSingular: { from: 'Cliente', to: 'Tutor' },
        customerPlural: { from: 'Clientes', to: 'Tutores' },
        pointsSingular: { from: 'Ponto', to: 'Patinha' },
        pointsPlural: { from: 'Pontos', to: 'Patinhas' },
        club: { from: 'Clube', to: 'Clube Pet' },
      },
    })
  })

  test('termo igual ao atual não cria auditoria; termo novo audita só o que mudou', async () => {
    await updateTerms(actor, biz.id, termos)
    await updateTerms(actor, biz.id, termos)
    await updateTerms(actor, biz.id, { ...termos, club: 'Clube Novo' })
    const logs = await auditoria('terms.updated')
    expect(logs).toHaveLength(2)
    expect(logs[1]?.metadata).toEqual({ changes: { club: { from: 'Clube Pet', to: 'Clube Novo' } } })
  })

  test('termo com caractere de controle é recusado', async () => {
    for (const v of ['Tutor\u0000', 'Tu\ntor', 'Tutor\u0007']) {
      expect((await domainError(updateTerms(actor, biz.id, { ...termos, customerSingular: v }))).code).toBe('validation')
    }
  })

  test.each([
    ['<b>Tosador</b>', 'professionalSingular'],
    ['Tutor>', 'customerSingular'],
    ['', 'pointsPlural'],
    ['   ', 'club'],
    ['x'.repeat(31), 'professionalPlural'],
  ])('termo %j em %s é recusado', async (valor, campo) => {
    const e = await domainError(updateTerms(actor, biz.id, { ...termos, [campo]: valor }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toContain(campo)
    expect((await getCustomization(actor, biz.id)).terms.professionalSingular).toBe('Profissional')
  })

  test('30 caracteres passam e espaços nas pontas saem', async () => {
    const r = await updateTerms(actor, biz.id, { ...termos, club: ` ${'c'.repeat(30)} ` })
    expect(r.club).toBe('c'.repeat(30))
  })
})

describe('updateModules', () => {
  test('vouchers sem loja falha; loja sem vouchers e os dois ligados passam', async () => {
    const e = await domainError(updateModules(actor, biz.id, { loyalty: false, banners: false, store: false, vouchers: true }))
    expect(e.code).toBe('validation')
    expect(e.message).toContain('Loja')
    expect(e.fields?.['vouchers']).toBeTruthy()
    expect(await updateModules(actor, biz.id, { loyalty: true, banners: false, store: true, vouchers: false })).toEqual({
      loyalty: true,
      banners: false,
      store: true,
      vouchers: false,
    })
    expect((await updateModules(actor, biz.id, { loyalty: true, banners: true, store: true, vouchers: true })).vouchers).toBe(true)
  })

  test('desligar a loja com vouchers ligado falha e mantém o que estava', async () => {
    await updateModules(actor, biz.id, { loyalty: false, banners: false, store: true, vouchers: true })
    const e = await domainError(updateModules(actor, biz.id, { loyalty: false, banners: false, store: false, vouchers: true }))
    expect(e.code).toBe('validation')
    expect(e.message).toMatch(/Vouchers/)
    const atual = await getBusinessDetail(actor, biz.id)
    expect(atual.modules).toMatchObject({ store: true, vouchers: true })
  })

  test('audita de e para', async () => {
    await updateModules(actor, biz.id, { loyalty: true, banners: false, store: false, vouchers: false })
    const [log] = await auditoria('modules.updated')
    expect(log?.metadata).toMatchObject({
      from: { loyalty: false, banners: false, store: false, vouchers: false },
      to: { loyalty: true, banners: false, store: false, vouchers: false },
    })
  })

  test('valor que não é booleano é recusado', async () => {
    const e = await domainError(updateModules(actor, biz.id, { loyalty: 'sim', banners: false, store: false, vouchers: false } as never))
    expect(e.code).toBe('validation')
  })
})

describe('setBrandImage', () => {
  const vinculo = async (campo: 'logoUploadId' | 'symbolUploadId' | 'faviconUploadId' | 'loginImageUploadId') =>
    (await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: biz.id } }))[campo]

  test('logo: grava, vincula, devolve a URL e registra quem enviou', async () => {
    const r = await setBrandImage(actor, biz.id, 'logo', await imagem(400, 200))
    const id = await vinculo('logoUploadId')
    const up = await prisma.upload.findUniqueOrThrow({ where: { id: id ?? '' } })
    expect(r.logoUrl).toBe(`/arquivos/${up.path}`)
    expect(up).toMatchObject({ businessId: biz.id, createdByType: 'PLATFORM_ADMIN', createdById: actor.adminId })
    expect(await disco.get(up.path)).not.toBeNull()
    expect(await auditoria('brand.image_changed')).toHaveLength(1)
  })

  test('trocar o logo apaga o arquivo e o registro anteriores, no disco e no banco', async () => {
    await setBrandImage(actor, biz.id, 'logo', await imagem(400, 200))
    const antigo = await prisma.upload.findFirstOrThrow({ where: { businessId: biz.id } })
    await setBrandImage(actor, biz.id, 'logo', await imagem(300, 100))
    expect(await disco.get(antigo.path)).toBeNull()
    expect(await prisma.upload.findUnique({ where: { id: antigo.id } })).toBeNull()
    expect(await prisma.upload.count({ where: { businessId: biz.id } })).toBe(1)
    expect(await arquivosNoDisco()).toHaveLength(1)
    const novo = await prisma.upload.findFirstOrThrow({ where: { businessId: biz.id } })
    expect(await vinculo('logoUploadId')).toBe(novo.id)
  })

  test('null remove o vínculo, o registro e o arquivo', async () => {
    await setBrandImage(actor, biz.id, 'symbol', await imagem(200, 200))
    const r = await setBrandImage(actor, biz.id, 'symbol', null)
    expect(r.symbolUrl).toBeNull()
    expect(await vinculo('symbolUploadId')).toBeNull()
    expect(await prisma.upload.count({ where: { businessId: biz.id } })).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
    expect(await auditoria('brand.image_changed')).toHaveLength(2)
  })

  test('remover onde não há imagem não faz nada e não dá erro', async () => {
    const r = await setBrandImage(actor, biz.id, 'favicon', null)
    expect(r.faviconUrl).toBeNull()
  })

  test('cada espaço tem o seu limite', async () => {
    const logo = await setBrandImage(actor, biz.id, 'logo', await imagem(3000, 1000))
    const symbol = await setBrandImage(actor, biz.id, 'symbol', await imagem(900, 600))
    const favicon = await setBrandImage(actor, biz.id, 'favicon', await imagem(300, 200))
    const entrada = await setBrandImage(actor, biz.id, 'loginImage', await imagem(4000, 1000))
    const dim = async (url: string | null) => {
      const up = await prisma.upload.findFirstOrThrow({ where: { path: (url ?? '').replace('/arquivos/', '') } })
      return [up.width, up.height, up.mimeType]
    }
    expect(await dim(logo.logoUrl)).toEqual([1200, 400, 'image/webp'])
    expect(await dim(symbol.symbolUrl)).toEqual([512, 512, 'image/webp'])
    expect(await dim(favicon.faviconUrl)).toEqual([64, 64, 'image/png'])
    expect(await dim(entrada.loginImageUrl)).toEqual([2400, 600, 'image/webp'])
  })

  test('símbolo menor que 64 px é recusado com mensagem clara', async () => {
    const e = await domainError(setBrandImage(actor, biz.id, 'symbol', await imagem(48, 48)))
    expect(e.code).toBe('validation')
    expect(e.message).toMatch(/64/)
    expect(await vinculo('symbolUploadId')).toBeNull()
    expect(await arquivosNoDisco()).toEqual([])
  })

  test('texto com extensão .png é recusado e nada é gravado', async () => {
    const e = await domainError(setBrandImage(actor, biz.id, 'logo', { bytes: new TextEncoder().encode('não sou imagem'), mime: 'image/png' }))
    expect(e.code).toBe('validation')
    expect(e.message).toMatch(/imagem/i)
    expect(await prisma.upload.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })

  test('SVG é recusado mesmo declarado como PNG', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    const e = await domainError(setBrandImage(actor, biz.id, 'logo', { bytes: svg, mime: 'image/png' }))
    expect(e.code).toBe('validation')
    expect(await prisma.upload.count()).toBe(0)
  })

  test('imagem acima do limite de pixels falha com mensagem que diz o limite', async () => {
    const { crc32, deflateSync } = await import('node:zlib')
    const bloco = (tipo: string, dados: Buffer) => {
      const tam = Buffer.alloc(4)
      tam.writeUInt32BE(dados.length)
      const corpo = Buffer.concat([Buffer.from(tipo), dados])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(corpo))
      return Buffer.concat([tam, corpo, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(7000, 0)
    ihdr.writeUInt32BE(6000, 4)
    ihdr.set([8, 2, 0, 0, 0], 8)
    const grande = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      bloco('IHDR', ihdr),
      bloco('IDAT', deflateSync(Buffer.alloc(10))),
      bloco('IEND', Buffer.alloc(0)),
    ])
    const e = await domainError(setBrandImage(actor, biz.id, 'loginImage', { bytes: new Uint8Array(grande), mime: 'image/png' }))
    expect(e.code).toBe('validation')
    expect(e.message).toMatch(/40 megapixels/)
    expect(await prisma.upload.count()).toBe(0)
  })

  test('arquivo acima de 8 MB é recusado', async () => {
    const e = await domainError(setBrandImage(actor, biz.id, 'logo', { bytes: new Uint8Array(8 * 1024 * 1024 + 1), mime: 'image/png' }))
    expect(e.code).toBe('validation')
    expect(e.message).toMatch(/8 MB/)
  })

  test.each(['banner', 'constructor', '__proto__', 'toString', 'hasOwnProperty'])('espaço %s é recusado com validation', async (slot) => {
    const e = await domainError(setBrandImage(actor, biz.id, slot as never, null))
    expect(e.code).toBe('validation')
    expect(e.fields?.['slot']).toBeTruthy()
  })

  test('conta inexistente (UUID válido): not_found, sem registro nem arquivo', async () => {
    const e = await domainError(setBrandImage(actor, '00000000-0000-4000-8000-000000000000', 'logo', await imagem(100, 100)))
    expect(e.code).toBe('not_found')
    expect(await prisma.upload.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })

  test('JPEG com EXIF e GPS sai sem metadados', async () => {
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#aa0000' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'dono-secreto' }, IFD3: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' } })
      .toBuffer()
    expect(jpeg.includes('dono-secreto')).toBe(true)
    for (const slot of ['logo', 'favicon'] as const) {
      const r = await setBrandImage(actor, biz.id, slot, { bytes: new Uint8Array(jpeg), mime: 'image/jpeg' })
      const url = slot === 'logo' ? r.logoUrl : r.faviconUrl
      const salvo = (await disco.get((url ?? '').replace('/arquivos/', '')))!.data
      expect(salvo.includes('dono-secreto')).toBe(false)
      const meta = await sharp(salvo).metadata()
      expect(meta.exif).toBeUndefined()
    }
  })

  test('GIF animado é recusado', async () => {
    const quadro = (cor: string) => sharp({ create: { width: 20, height: 20, channels: 3, background: cor } }).png().toBuffer()
    const gif = await sharp([await quadro('#ff0000'), await quadro('#0000ff')], { join: { animated: true } })
      .gif({ loop: 0, delay: [100, 100] })
      .toBuffer()
    const e = await domainError(setBrandImage(actor, biz.id, 'loginImage', { bytes: new Uint8Array(gif), mime: 'image/gif' }))
    expect(e.code).toBe('validation')
    expect(await prisma.upload.count()).toBe(0)
  })

  test('falha ao vincular (marca inexistente) não deixa arquivo nem registro da imagem nova', async () => {
    await prisma.businessBranding.delete({ where: { businessId: biz.id } })
    await expect(setBrandImage(actor, biz.id, 'logo', await imagem(100, 100))).rejects.toMatchObject({ code: 'not_found' })
    expect(await prisma.upload.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })

  test('falha ao apagar o arquivo antigo é registrada em log e não desfaz a troca', async () => {
    await setBrandImage(actor, biz.id, 'logo', await imagem(400, 200))
    const antigo = await prisma.upload.findFirstOrThrow({ where: { businessId: biz.id } })
    falhaAoApagar = (k) => k === antigo.path
    const erro = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const r = await setBrandImage(actor, biz.id, 'logo', await imagem(300, 100))
    expect(r.logoUrl).not.toBe(`/arquivos/${antigo.path}`)
    expect(r.logoUrl).not.toBeNull()
    expect(erro).toHaveBeenCalledTimes(1)
    const linha = String(erro.mock.calls[0]?.[0])
    expect(linha).toContain('brand_image_cleanup_failed')
    expect(linha).not.toContain('disco recusou')
    // O arquivo velho ficou, mas o registro continua rastreável (sem vínculo) para limpeza posterior.
    expect(await prisma.upload.findUnique({ where: { id: antigo.id } })).not.toBeNull()
    expect(await vinculoAtual()).not.toBe(antigo.id)
  })

  async function vinculoAtual() {
    return (await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: biz.id } })).logoUploadId
  }

  test('duas trocas ao mesmo tempo não deixam imagem sem vínculo para trás', async () => {
    await setBrandImage(actor, biz.id, 'logo', await imagem(400, 200))
    await Promise.all([
      setBrandImage(actor, biz.id, 'logo', await imagem(300, 100)),
      setBrandImage(actor, biz.id, 'logo', await imagem(200, 100)),
    ])
    expect(await prisma.upload.count({ where: { businessId: biz.id } })).toBe(1)
    expect(await arquivosNoDisco()).toHaveLength(1)
    expect((await prisma.upload.findFirstOrThrow({ where: { businessId: biz.id } })).id).toBe(await vinculoAtual())
  })

  test('a troca não mexe na versão da marca', async () => {
    await setBrandImage(actor, biz.id, 'logo', await imagem(100, 100))
    expect((await getCustomization(actor, biz.id)).brand.version).toBe(1)
  })
})

describe('regras, fuso e avisos pelo admin', () => {
  test('regras alteradas pelo admin aparecem em getSchedulingRules da conta e saem na auditoria como do admin', async () => {
    const r = await updateRulesAsAdmin(actor, biz.id, { slotStepMin: 30, bufferMin: 10, autoConfirm: false })
    expect(r.rules).toMatchObject({ slotStepMin: 30, bufferMin: 10, autoConfirm: false, minLeadMin: 60 })
    const ctx = await ctxWithRole(biz, 'OWNER')
    expect(await getSchedulingRules(ctx)).toMatchObject({ slotStepMin: 30, bufferMin: 10, autoConfirm: false })
    const [log] = await auditoria('scheduling_rules.updated')
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: actor.adminId, onBehalf: false })
  })

  test('valor inválido é recusado pela mesma validação do dono', async () => {
    const e = await domainError(updateRulesAsAdmin(actor, biz.id, { slotStepMin: 7 }))
    expect(e.code).toBe('validation')
  })

  test('conta suspensa também pode ser ajustada', async () => {
    const b = await makeBusiness({ status: 'SUSPENDED' })
    expect((await updateRulesAsAdmin(actor, b.id, { bufferMin: 15 })).rules.bufferMin).toBe(15)
  })

  test('trocar o fuso grava o fuso canônico e a auditoria com antes e depois', async () => {
    const r = await updateRulesAsAdmin(actor, biz.id, { timeZone: 'america/manaus' })
    expect(r.timeZone).toBe('America/Manaus')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: biz.id } })).timezone).toBe('America/Manaus')
    const [log] = await auditoria('business.timezone_changed')
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: actor.adminId })
    expect(log?.metadata).toMatchObject({ from: 'America/Sao_Paulo', to: 'America/Manaus' })
  })

  test('fuso inválido é recusado e nada muda, nem as regras enviadas junto', async () => {
    const e = await domainError(updateRulesAsAdmin(actor, biz.id, { timeZone: 'Marte/Olimpo', bufferMin: 20 }))
    expect(e.code).toBe('validation')
    expect(e.fields?.['timeZone']).toBeTruthy()
    expect((await getCustomization(actor, biz.id)).rules.bufferMin).toBe(0)
    expect(await auditoria('business.timezone_changed')).toHaveLength(0)
  })

  test('tudo ou nada: regra inválida com fuso válido não grava o fuso; fuso inválido com regra válida não grava a regra', async () => {
    await domainError(updateRulesAsAdmin(actor, biz.id, { timeZone: 'Asia/Tokyo', slotStepMin: 7 }))
    await domainError(updateRulesAsAdmin(actor, biz.id, { timeZone: 'Marte/Olimpo', bufferMin: 25 }))
    const c = await getCustomization(actor, biz.id)
    expect([c.timeZone, c.rules.slotStepMin, c.rules.bufferMin]).toEqual(['America/Sao_Paulo', 15, 0])
    expect(await prisma.auditLog.count({ where: { businessId: biz.id } })).toBe(0)
  })

  test('regras e fuso válidos juntos gravam os dois e auditam os dois', async () => {
    const r = await updateRulesAsAdmin(actor, biz.id, { timeZone: 'Asia/Tokyo', bufferMin: 25 })
    expect([r.timeZone, r.rules.bufferMin]).toEqual(['Asia/Tokyo', 25])
    expect(await auditoria('scheduling_rules.updated')).toHaveLength(1)
    expect(await auditoria('business.timezone_changed')).toHaveLength(1)
  })

  test('mesmo fuso: sem auditoria de troca', async () => {
    await updateRulesAsAdmin(actor, biz.id, { timeZone: 'America/Sao_Paulo' })
    expect(await auditoria('business.timezone_changed')).toHaveLength(0)
  })

  test('trocar o fuso com agendamentos futuros é permitido e os instantes não mudam', async () => {
    const servico = await makeService(biz.id)
    const profissional = await makeProfessional(biz.id, { serviceIds: [servico.id] })
    const cliente = await makeCustomer(biz.id)
    const inicio = new Date(Date.now() + 3 * 24 * 3600 * 1000)
    const ag = await makeAppointment(biz.id, { customerId: cliente.id, professionalId: profissional.id, serviceId: servico.id, startsAt: inicio })
    await updateRulesAsAdmin(actor, biz.id, { timeZone: 'Asia/Tokyo' })
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id } })).startsAt.getTime()).toBe(inicio.getTime())
    expect((await getCustomization(actor, biz.id)).timeZone).toBe('Asia/Tokyo')
  })

  test('sem nada para mudar devolve o estado atual', async () => {
    const r = await updateRulesAsAdmin(actor, biz.id, {})
    expect(r.timeZone).toBe('America/Sao_Paulo')
    expect(r.rules.slotStepMin).toBe(15)
  })

  test('avisos: o admin liga e desliga canais e a conta lê o resultado', async () => {
    const atual = (await getCustomization(actor, biz.id)).notifications
    const novo = { ...atual, APPOINTMENT_CONFIRMED: { email: false, push: true } }
    const r = await updateNotificationsAsAdmin(actor, biz.id, novo)
    expect(r.APPOINTMENT_CONFIRMED).toEqual({ email: false, push: true })
    const ctx = await ctxWithRole(biz, 'MANAGER')
    expect((await getNotificationSettings(ctx)).APPOINTMENT_CONFIRMED).toEqual({ email: false, push: true })
    const [log] = await auditoria('notification_settings.updated')
    expect(log).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: actor.adminId })
  })

  test('avisos: tipo desconhecido é recusado', async () => {
    const atual = (await getCustomization(actor, biz.id)).notifications
    const e = await domainError(updateNotificationsAsAdmin(actor, biz.id, { ...atual, INVENTADO: { email: true, push: true } } as never))
    expect(e.code).toBe('validation')
  })

  test('conta inexistente: not_found', async () => {
    expect((await domainError(updateRulesAsAdmin(actor, '00000000-0000-4000-8000-000000000000', { bufferMin: 5 }))).code).toBe('not_found')
  })
})

describe('admin desativado com o objeto de ator antigo', () => {
  test('toda escrita relê o admin na transação: forbidden e nada gravado', async () => {
    await prisma.platformAdmin.update({ where: { id: actor.adminId }, data: { active: false } })
    const chamadas = [
      () => updateBrand(actor, biz.id, 1, { ...brand, displayName: 'Outro Nome' }),
      () => updateTerms(actor, biz.id, { ...termos, club: 'Clube Novo' }),
      () => updateModules(actor, biz.id, { loyalty: true, banners: false, store: false, vouchers: false }),
      () => updateRulesAsAdmin(actor, biz.id, { bufferMin: 5 }),
      () => updateRulesAsAdmin(actor, biz.id, { timeZone: 'Asia/Tokyo' }),
      () => updateNotificationsAsAdmin(actor, biz.id, { APPOINTMENT_CONFIRMED: { email: false, push: false } } as never),
      () => setBrandImage(actor, biz.id, 'logo', null),
    ]
    for (const chamar of chamadas) expect((await domainError(chamar())).code).toBe('forbidden')
    expect(await prisma.auditLog.count({ where: { businessId: biz.id } })).toBe(0)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: biz.id } })).timezone).toBe('America/Sao_Paulo')
  })
})

describe('texto com emoji composto', () => {
  test('o caractere de junção (U+200D) vale em nome de exibição, termos e mensagem; os demais caracteres de controle seguem recusados', async () => {
    const familia = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
    const v = (await getCustomization(actor, biz.id)).brand.version
    const marca = await updateBrand(actor, biz.id, v, { ...brand, displayName: `${familia} Casa`, loginMessage: `Olá ${familia}\nVolte sempre.` })
    expect(marca.displayName).toBe(`${familia} Casa`)
    expect(marca.loginMessage).toBe(`Olá ${familia}\nVolte sempre.`)
    expect((await updateTerms(actor, biz.id, { ...termos, club: `Clube ${familia}` })).club).toBe(`Clube ${familia}`)

    for (const ruim of ['a\u200Bb', 'a\tb', 'a\u0000b', 'a\u202Eb']) {
      expect((await domainError(updateBrand(actor, biz.id, marca.version, { ...brand, displayName: ruim }))).code, JSON.stringify(ruim)).toBe('validation')
      expect((await domainError(updateTerms(actor, biz.id, { ...termos, club: ruim }))).code, JSON.stringify(ruim)).toBe('validation')
    }
    expect((await domainError(updateBrand(actor, biz.id, marca.version, { ...brand, loginMessage: 'a\u200Bb' }))).code).toBe('validation')
  })
})

describe('texto só de caractere invisível', () => {
  const ZWJ = '\u200D'
  const familia = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'
  const bandeira = '\u{1F3F3}\uFE0F\u200D\u{1F308}'

  test('junção de emoji solta (só ela, no início, no fim, repetida ou junto de espaço) é recusada em nome, termos e mensagem', async () => {
    const v = (await getCustomization(actor, biz.id)).brand.version
    for (const ruim of [ZWJ, ZWJ + ZWJ, 'a' + ZWJ, ZWJ + 'a', 'Pet' + ZWJ, 'a' + ZWJ + ZWJ + 'b', 'a ' + ZWJ + ' b']) {
      const rotulo = JSON.stringify(ruim)
      expect((await domainError(updateBrand(actor, biz.id, v, { ...brand, displayName: ruim }))).code, rotulo).toBe('validation')
      expect((await domainError(updateTerms(actor, biz.id, { ...termos, club: ruim }))).code, rotulo).toBe('validation')
      expect((await domainError(updateBrand(actor, biz.id, v, { ...brand, loginMessage: ruim }))).code, rotulo).toBe('validation')
    }
  })

  test('emoji composto de verdade dentro do nome vale', async () => {
    const v = (await getCustomization(actor, biz.id)).brand.version
    const m = await updateBrand(actor, biz.id, v, { ...brand, displayName: `${familia} Casa ${bandeira}` })
    expect(m.displayName).toBe(`${familia} Casa ${bandeira}`)
    expect((await updateTerms(actor, biz.id, { ...termos, club: bandeira })).club).toBe(bandeira)
  })
})
