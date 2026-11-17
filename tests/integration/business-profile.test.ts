import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { updateBusinessData } from '@/server/domain/platform/businesses'
import {
  getBusinessProfile,
  getTermLabels,
  getTerms,
  setBusinessLogo,
  updateBusinessProfile,
  updateTermsAsOwner,
} from '@/server/domain/settings/business-profile'
import { createLocalDiskStorage } from '@/server/storage/local-disk'
import type { Storage } from '@/server/storage/storage'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer, makePlatformAdmin } from '../setup/factories'

let dir: string
let disco: Storage
vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => disco }
})

const png = async (w: number, h: number) => ({
  bytes: new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#0e4f5c' } }).png().toBuffer()),
})
async function arquivosNoDisco(): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true })
  return entradas.filter((e) => e.isFile() && !e.name.endsWith('.meta')).map((e) => e.name)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-profile-'))
  disco = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await resetDb()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
})

const TERMOS = {
  professionalSingular: 'Tosador',
  professionalPlural: 'Tosadores',
  customerSingular: 'Tutor',
  customerPlural: 'Tutores',
  pointsSingular: 'Patinha',
  pointsPlural: 'Patinhas',
  club: 'Clube Pet',
}

describe('dados do negócio', () => {
  test('o dono lê o perfil da conta com o endereço de entrada e a versão', async () => {
    const b = await makeBusiness({ slug: 'pet-bonito', email: 'oi@pet.com.br', phone: '5511987654321' })
    const p = await getBusinessProfile(await makeCtx(b))
    expect(p).toMatchObject({
      contactEmail: 'oi@pet.com.br',
      contactPhone: '5511987654321',
      phoneLabel: '(11) 98765-4321',
      timeZone: 'America/Sao_Paulo',
      logoUrl: null,
      version: 1,
    })
    expect(p.entryUrl).toContain('/entrar/pet-bonito')
    expect(p.name).toBe((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId: b.id } })).displayName)
  })

  test('o dono muda nome e contato, a versão sobe e a auditoria guarda o nome de antes e depois, sem e-mail nem telefone', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const antes = await getBusinessProfile(ctx)
    const r = await updateBusinessProfile(ctx, antes.version, {
      name: '  Pet Bonito  ',
      contactEmail: 'Oi@Pet.com.br',
      contactPhone: '(11) 98765-4321',
    })
    expect(r).toMatchObject({ name: 'Pet Bonito', contactEmail: 'oi@pet.com.br', contactPhone: '5511987654321', version: 2 })
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).phone).toBe('5511987654321')
    const [log] = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'business_profile.updated' } })
    expect(log?.metadata).toMatchObject({ changes: { name: { from: antes.name, to: 'Pet Bonito' } } })
    expect(JSON.stringify(log?.metadata)).not.toMatch(/oi@pet|98765/)
  })

  test('campos vazios apagam o contato', async () => {
    const b = await makeBusiness({ email: 'a@b.com', phone: '5511987654321' })
    const ctx = await makeCtx(b)
    const p = await getBusinessProfile(ctx)
    const r = await updateBusinessProfile(ctx, p.version, { name: p.name, contactEmail: null, contactPhone: null })
    expect(r).toMatchObject({ contactEmail: null, contactPhone: null, phoneLabel: null })
  })

  test('versão antiga dá conflict stale_version e nada muda', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await getBusinessProfile(ctx)
    await updateBusinessProfile(ctx, p.version, { name: 'Um', contactEmail: null, contactPhone: null })
    const e = await domainError(updateBusinessProfile(ctx, p.version, { name: 'Dois', contactEmail: null, contactPhone: null }))
    expect([e.code, e.reason]).toEqual(['conflict', 'stale_version'])
    expect((await getBusinessProfile(ctx)).name).toBe('Um')
  })

  test('a versão do perfil é a do negócio: o dono e o painel dev não sobrescrevem o contato um do outro', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const a = await makePlatformAdmin()
    const admin = { kind: 'platform_admin' as const, adminId: a.id, name: a.name }
    const lida = await getBusinessProfile(ctx)
    expect(lida.version).toBe((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).version)
    // O admin grava primeiro, com a mesma versão lida: o dono, que ainda tem a versão antiga, recebe conflito.
    await updateBusinessData(admin, b.id, lida.version, { contactEmail: 'admin@pet.com.br' })
    const dono = await domainError(updateBusinessProfile(ctx, lida.version, { name: lida.name, contactEmail: 'dono@pet.com.br', contactPhone: null }))
    expect([dono.code, dono.reason]).toEqual(['conflict', 'stale_version'])
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).email).toBe('admin@pet.com.br')
    // E no sentido contrário: o dono grava, o admin com a versão antiga recebe conflito.
    const nova = await getBusinessProfile(ctx)
    await updateBusinessProfile(ctx, nova.version, { name: nova.name, contactEmail: 'dono@pet.com.br', contactPhone: null })
    const adm = await domainError(updateBusinessData(admin, b.id, nova.version, { contactEmail: 'admin2@pet.com.br' }))
    expect([adm.code, adm.reason]).toEqual(['conflict', 'stale_version'])
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).email).toBe('dono@pet.com.br')
  })

  test('mudar só o nome também sobe a versão do negócio', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await getBusinessProfile(ctx)
    const r = await updateBusinessProfile(ctx, p.version, { name: 'Só o nome', contactEmail: p.contactEmail, contactPhone: p.contactPhone })
    expect(r.version).toBe(p.version + 1)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: b.id } })).version).toBe(p.version + 1)
  })

  test('gravar o mesmo que já está não sobe a versão nem audita', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await getBusinessProfile(ctx)
    const r = await updateBusinessProfile(ctx, p.version, { name: p.name, contactEmail: p.contactEmail, contactPhone: p.contactPhone })
    expect(r.version).toBe(p.version)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'business_profile.updated' } })).toBe(0)
  })

  test('só o dono (e o suporte) muda os dados; gerente e profissional recebem forbidden', async () => {
    const b = await makeBusiness()
    const dados = { name: 'X', contactEmail: null, contactPhone: null }
    for (const papel of ['MANAGER', 'PROFESSIONAL'] as const) {
      const ctx = await ctxWithRole(b, papel)
      expect((await domainError(updateBusinessProfile(ctx, 1, dados))).code).toBe('forbidden')
      expect((await domainError(setBusinessLogo(ctx, null))).code).toBe('forbidden')
    }
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } })
    expect((await updateBusinessProfile(suporte, 1, dados)).name).toBe('X')
    expect((await domainError(getBusinessProfile(await ctxWithRole(b, 'PROFESSIONAL')))).code).toBe('forbidden')
    expect((await getBusinessProfile(await ctxWithRole(b, 'MANAGER'))).version).toBeGreaterThan(0)
  })

  test('o tipo não tem identificador, fuso nem cor: campo extra vindo de fora é recusado', async () => {
    const b = await makeBusiness({ slug: 'meu-slug' })
    const ctx = await makeCtx(b)
    const base = { name: 'Pet', contactEmail: null, contactPhone: null }
    for (const extra of [{ slug: 'outro' }, { timeZone: 'Asia/Tokyo' }, { primary: '#FF0000' }, { material: 'LEATHER' }, { modules: {} }]) {
      const e = await domainError(updateBusinessProfile(ctx, 1, { ...base, ...extra } as typeof base))
      expect(e.code).toBe('validation')
    }
    const conta = await prisma.business.findUniqueOrThrow({ where: { id: b.id } })
    expect([conta.slug, conta.timezone]).toEqual(['meu-slug', 'America/Sao_Paulo'])
  })

  test('valida nome e e-mail com os campos certos', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const nome = await domainError(updateBusinessProfile(ctx, 1, { name: '  ', contactEmail: null, contactPhone: null }))
    expect(Object.keys(nome.fields ?? {})).toContain('name')
    const marca = await domainError(updateBusinessProfile(ctx, 1, { name: '<b>x</b>', contactEmail: null, contactPhone: null }))
    expect(Object.keys(marca.fields ?? {})).toContain('name')
    const mail = await domainError(updateBusinessProfile(ctx, 1, { name: 'X', contactEmail: 'sem-arroba', contactPhone: null }))
    expect(Object.keys(mail.fields ?? {})).toContain('contactEmail')
  })

  test('telefone: brasileiro grava; estrangeiro sem + orienta a começar com + e o código do país; com + grava', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const base = { name: 'Pet', contactEmail: null }
    expect((await updateBusinessProfile(ctx, 1, { ...base, contactPhone: '11987654321' })).contactPhone).toBe('5511987654321')
    const e = await domainError(updateBusinessProfile(ctx, 2, { ...base, contactPhone: '4915112345678' }))
    expect(e.code).toBe('validation')
    expect(e.fields?.['contactPhone']).toMatch(/Comece com \+ e o código do país/)
    const ok = await updateBusinessProfile(ctx, 2, { ...base, contactPhone: '+49 151 1234 5678' })
    expect([ok.contactPhone, ok.phoneLabel]).toEqual(['4915112345678', '+4915112345678'])
  })

  test('duas gravações com a mesma versão ao mesmo tempo: uma entra e a outra recebe stale_version', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const r = await Promise.allSettled([
      updateBusinessProfile(ctx, 1, { name: 'A', contactEmail: null, contactPhone: null }),
      updateBusinessProfile(ctx, 1, { name: 'B', contactEmail: null, contactPhone: null }),
    ])
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const falha = r.find((x) => x.status === 'rejected')
    expect(falha).toMatchObject({ reason: { code: 'conflict', reason: 'stale_version' } })
  })
})

describe('logo', () => {
  test('o dono troca a logo, a anterior sai do disco e do banco, e as regras de imagem valem', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const um = await setBusinessLogo(ctx, await png(400, 200))
    expect(um.logoUrl).toMatch(/^\/arquivos\//)
    const dois = await setBusinessLogo(ctx, await png(300, 100))
    expect(dois.logoUrl).not.toBe(um.logoUrl)
    expect(await prisma.upload.count({ where: { businessId: b.id } })).toBe(1)
    expect(await arquivosNoDisco()).toHaveLength(1)
    const sem = await setBusinessLogo(ctx, null)
    expect(sem.logoUrl).toBeNull()
    expect(await arquivosNoDisco()).toEqual([])
    const ruim = await domainError(setBusinessLogo(ctx, { bytes: new Uint8Array([1, 2, 3]) }))
    expect(ruim.code).toBe('validation')
    expect(ruim.details).toMatchObject({ imageCode: 'not_an_image' })
  })

  test('troca de logo não mexe na versão do perfil e audita; o suporte também troca', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await setBusinessLogo(ctx, await png(100, 100))
    expect((await getBusinessProfile(ctx)).version).toBe(1)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'brand.image_changed' } })).toBe(1)
    const admin = await makePlatformAdmin()
    const suporte = await makeCtx(b, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } })
    expect((await setBusinessLogo(suporte, null)).logoUrl).toBeNull()
  })
})

describe('rótulos dos termos', () => {
  test('qualquer membro da equipe lê os termos da conta, sem versão; quem não é da equipe não', async () => {
    const b = await makeBusiness()
    await updateTermsAsOwner(await makeCtx(b), 1, TERMOS)
    for (const papel of ['OWNER', 'MANAGER', 'PROFESSIONAL'] as const) {
      expect(await getTermLabels(await ctxWithRole(b, papel))).toEqual(TERMOS)
    }
    const cliente = await makeCustomer(b.id)
    const comoCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name } })
    expect((await domainError(getTermLabels(comoCliente))).code).toBe('forbidden')
  })
})

describe('termos pelo dono', () => {
  test('dono e gerente gravam, profissional não; a versão sobe e a auditoria guarda antes e depois', async () => {
    const b = await makeBusiness()
    const dono = await makeCtx(b)
    const gerente = await ctxWithRole(b, 'MANAGER')
    const inicial = await getTerms(dono)
    expect(inicial.version).toBe(1)
    const r = await updateTermsAsOwner(dono, inicial.version, TERMOS)
    expect(r).toEqual({ terms: TERMOS, version: 2 })
    expect((await getTerms(gerente)).terms).toEqual(TERMOS)
    expect((await updateTermsAsOwner(gerente, 2, { ...TERMOS, club: 'Clube Novo' })).version).toBe(3)
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(updateTermsAsOwner(prof, 3, TERMOS))).code).toBe('forbidden')
    expect((await domainError(getTerms(prof))).code).toBe('forbidden')
    const logs = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'terms.updated' }, orderBy: { createdAt: 'asc' } })
    expect(logs).toHaveLength(2)
    expect(logs[1]?.metadata).toEqual({ changes: { club: { from: 'Clube Pet', to: 'Clube Novo' } } })
  })

  test('versão antiga dá stale_version; termo igual não sobe a versão; objeto com campo extra é recusado', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await updateTermsAsOwner(ctx, 1, TERMOS)
    const e = await domainError(updateTermsAsOwner(ctx, 1, { ...TERMOS, club: 'Outro' }))
    expect([e.code, e.reason]).toEqual(['conflict', 'stale_version'])
    expect((await updateTermsAsOwner(ctx, 2, TERMOS)).version).toBe(2)
    const extra = await domainError(updateTermsAsOwner(ctx, 2, { ...TERMOS, loyalty: true } as typeof TERMOS))
    expect(extra.code).toBe('validation')
    const marca = await domainError(updateTermsAsOwner(ctx, 2, { ...TERMOS, club: '<b>x</b>' }))
    expect(Object.keys(marca.fields ?? {})).toContain('club')
  })
})
