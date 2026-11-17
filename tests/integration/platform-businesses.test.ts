import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import {
  createBusiness,
  getBusinessDetail,
  getBusinessNames,
  listBusinesses,
  setBusinessStatus,
  slugSchema,
  updateBusinessData,
} from '@/server/domain/platform/businesses'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeMembership, makePlatformAdmin, makeUser } from '../setup/factories'
import { fakeMail } from '../setup/mail'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

const mail = fakeMail()
let actor: PlatformAdminActor
let adminId: string
beforeEach(async () => {
  await resetDb()
  const admin = await makePlatformAdmin()
  adminId = admin.id
  actor = { kind: 'platform_admin', adminId: admin.id, name: admin.name }
  mail.install()
})
afterEach(() => mail.uninstall())

const base = {
  name: 'Barbearia Central',
  slug: 'central',
  timeZone: 'america/manaus',
  owner: { name: 'João Silva', email: 'Joao@Exemplo.test' },
}

function tokenDoEmail(i = mail.sent.length - 1): string {
  const m = /\/definir-senha\/([A-Za-z0-9_-]+)/.exec(mail.sent[i]?.text ?? '')
  if (!m?.[1]) throw new Error('O e-mail não traz o link de definir senha.')
  return m[1]
}

const UUID_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

describe('createBusiness', () => {
  test('dono novo: usuário sem senha, vínculo OWNER, convite só com hash e e-mail com o link', async () => {
    const r = await createBusiness(actor, base)
    expect(r.business).toMatchObject({ name: 'Barbearia Central', slug: 'central', status: 'ACTIVE', timeZone: 'America/Manaus', version: 1 })
    expect(r.business.entryUrl).toBe('http://painel.localhost:3000/entrar/central')
    expect(r.business.ownerName).toBe('João Silva')
    expect(r.owner.existing).toBe(false)
    expect(r.emailSent).toBe(true)

    const user = await prisma.user.findUniqueOrThrow({ where: { id: r.owner.userId } })
    expect(user.email).toBe('joao@exemplo.test')
    expect(user.passwordHash).toBeNull()
    const vinculo = await prisma.membership.findFirstOrThrow({ where: { businessId: r.business.id, userId: user.id } })
    expect(vinculo.role).toBe('OWNER')
    expect(vinculo.active).toBe(true)

    const token = tokenDoEmail()
    const convite = await prisma.userToken.findFirstOrThrow({ where: { userId: user.id } })
    expect(convite.purpose).toBe('INVITE')
    expect(convite.tokenHash).toBe(hashToken(token))
    expect(convite.tokenHash).not.toBe(token)
    expect(convite.usedAt).toBeNull()
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]).toMatchObject({ to: 'joao@exemplo.test' })
    expect(mail.sent[0]?.text).toContain(`http://painel.localhost:3000/definir-senha/${token}`)
    expect(mail.sent[0]?.text).toContain('Barbearia Central')
  })

  test('cria marca, módulos e regras padrão da conta', async () => {
    const r = await createBusiness(actor, base)
    const conta = await prisma.business.findUniqueOrThrow({
      where: { id: r.business.id },
      include: { branding: true, modules: true, settings: true },
    })
    expect(conta.branding?.displayName).toBe('Barbearia Central')
    expect(conta.modules).toMatchObject({ loyalty: false, banners: false, store: false, vouchers: false })
    expect(conta.settings).toMatchObject({ slotStepMin: 15, minLeadMin: 60, autoConfirm: true })
    expect(r.business.modules).toEqual({ loyalty: false, banners: false, store: false, vouchers: false })
  })

  test('a auditoria não guarda o token do convite', async () => {
    await createBusiness(actor, base)
    const token = tokenDoEmail()
    expect(JSON.stringify(await prisma.auditLog.findMany())).not.toContain(token)
  })

  test('dono que já existe: só o vínculo, senha intacta, nenhum convite e e-mail de aviso', async () => {
    const outra = await makeBusiness()
    const existente = await makeUser({ name: 'Helena', email: 'helena@exemplo.test', password: 'senha-da-helena-1' })
    await makeMembership(outra.id, existente.id, 'OWNER')
    const antes = existente.passwordHash

    const r = await createBusiness(actor, { ...base, owner: { name: 'Outro Nome', email: 'HELENA@exemplo.test' } })
    expect(r.owner).toEqual({ userId: existente.id, existing: true })
    expect(r.emailSent).toBe(true)
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: existente.id } })
    expect(depois.passwordHash).toBe(antes)
    expect(depois.name).toBe('Helena')
    expect(await prisma.userToken.count()).toBe(0)
    const vinculo = await prisma.membership.findFirstOrThrow({ where: { businessId: r.business.id, userId: existente.id } })
    expect(vinculo.role).toBe('OWNER')
    expect(mail.sent).toHaveLength(1)
    expect(mail.sent[0]?.to).toBe('helena@exemplo.test')
    expect(mail.sent[0]?.text).toContain('Barbearia Central')
    expect(mail.sent[0]?.text).not.toContain('definir-senha')
    expect(mail.sent[0]?.text).toContain('http://painel.localhost:3000/entrar/central')
  })

  test('dono existente sem senha: emite convite novo e manda o e-mail de convite', async () => {
    const outra = await makeBusiness()
    const pendente = await makeUser({ name: 'Pendente', email: 'pendente@exemplo.test', password: null })
    await makeMembership(outra.id, pendente.id, 'OWNER')
    await prisma.userToken.create({ data: { userId: pendente.id, purpose: 'INVITE', tokenHash: 'velho', expiresAt: new Date(Date.now() - 1000) } })
    const r = await createBusiness(actor, { ...base, owner: { name: 'X', email: 'pendente@exemplo.test' } })
    expect(r.owner).toEqual({ userId: pendente.id, existing: true })
    const token = tokenDoEmail()
    const convites = await prisma.userToken.findMany({ where: { userId: pendente.id } })
    expect(convites).toHaveLength(1)
    expect(convites[0]?.tokenHash).toBe(hashToken(token))
    expect(mail.sent[0]?.text).toContain('/definir-senha/')
  })

  test('falha no envio não desfaz a conta e aparece no retorno', async () => {
    mail.failing = true
    const r = await createBusiness(actor, base)
    expect(r.emailSent).toBe(false)
    expect(await prisma.business.count()).toBe(1)
    expect(await prisma.userToken.count()).toBe(1)
  })

  test('sem canal de e-mail configurado, emailSent é falso', async () => {
    mail.uninstall()
    const r = await createBusiness(actor, { ...base, slug: 'sem-canal' })
    expect(r.emailSent).toBe(false)
  })

  test('o e-mail escapa HTML do nome da conta e do dono', async () => {
    await createBusiness(actor, { ...base, name: 'Loja <b>Z</b> & Cia', owner: { name: '<script>x</script>', email: 'z@exemplo.test' } })
    const html = mail.sent[0]?.html ?? ''
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>Z</b>')
    expect(html).toContain('&lt;b&gt;Z&lt;/b&gt; &amp; Cia')
  })

  test('slug inválido: reservado, duplicado, maiúscula, hífen nas pontas, curto, longo e símbolo', async () => {
    await createBusiness(actor, base)
    const ruins = ['entrar', 'api', 'definir-senha', 'central', 'Central', '-central', 'central-', 'ab', 'a'.repeat(41), 'cen tral', 'café']
    for (const [n, slug] of ruins.entries()) {
      const e = await domainError(createBusiness(actor, { ...base, slug, owner: { name: 'X', email: `x${n}@exemplo.test` } }))
      expect(e.code, slug).toBe('validation')
      expect(e.fields, slug).toHaveProperty('slug')
    }
    expect(await prisma.business.count()).toBe(1)
    expect(slugSchema.safeParse('minha-loja-2').success).toBe(true)
    expect(slugSchema.safeParse('suporte').success).toBe(false)
  })

  test('dois cadastros simultâneos com o mesmo slug: um passa, o outro recebe erro no campo slug', async () => {
    const resultados = await Promise.allSettled([
      createBusiness(actor, { ...base, slug: 'mesma', owner: { name: 'A', email: 'a@exemplo.test' } }),
      createBusiness(actor, { ...base, slug: 'mesma', owner: { name: 'B', email: 'b@exemplo.test' } }),
    ])
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejeitada = resultados.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect((rejeitada?.reason as { fields?: Record<string, string> }).fields).toHaveProperty('slug')
    expect(await prisma.business.count()).toBe(1)
  })

  test('fuso: grava o nome canônico e recusa fuso inexistente', async () => {
    const r = await createBusiness(actor, base)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: r.business.id } })).timezone).toBe('America/Manaus')
    const e = await domainError(createBusiness(actor, { ...base, slug: 'outra', timeZone: 'Marte/Olimpo' }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('timeZone')
  })

  test('documento: CNPJ e CPF válidos passam (só dígitos); dígito errado falha', async () => {
    const cnpj = await createBusiness(actor, { ...base, document: '11.222.333/0001-81' })
    expect(cnpj.business.document).toBe('11222333000181')
    const cpf = await createBusiness(actor, { ...base, slug: 'cpf', document: '52998224725', owner: { name: 'C', email: 'c@exemplo.test' } })
    expect(cpf.business.document).toBe('52998224725')
    for (const ruim of ['11222333000182', '52998224726', '11111111111', '123']) {
      const e = await domainError(createBusiness(actor, { ...base, slug: 'ruim', document: ruim, owner: { name: 'R', email: 'r@exemplo.test' } }))
      expect(e.fields, ruim).toHaveProperty('document')
    }
  })

  test('CNPJ alfanumérico: válido passa (maiúsculas, sem pontuação); dígito trocado e repetidos falham', async () => {
    const ok = await createBusiness(actor, { ...base, slug: 'alfa', document: '12.abc.345/01de-35', owner: { name: 'A', email: 'alfa@exemplo.test' } })
    expect(ok.business.document).toBe('12ABC34501DE35')
    for (const ruim of ['12ABC34501DE36', '12ABC34501DE3A', 'AAAAAAAAAAAAAA', '12ABC34501DE']) {
      const e = await domainError(createBusiness(actor, { ...base, slug: 'ruim', document: ruim, owner: { name: 'R', email: 'r@exemplo.test' } }))
      expect(e.fields, ruim).toHaveProperty('document')
    }
  })

  test('e-mail do dono inválido falha no campo owner.email', async () => {
    const e = await domainError(createBusiness(actor, { ...base, owner: { name: 'X', email: 'nao-e-email' } }))
    expect(e.fields).toHaveProperty('owner.email')
  })

  test('grava auditoria com o admin como autor', async () => {
    const r = await createBusiness(actor, { ...base, internalNotes: 'cliente indicado' })
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { action: 'business.created' } })
    expect(linha).toMatchObject({ actorType: 'PLATFORM_ADMIN', actorId: adminId, businessId: r.business.id, targetType: 'business', targetId: r.business.id })
  })
})

describe('listBusinesses e getBusinessDetail', () => {
  test('busca "joao" acha a conta cujo dono é "João", sem diferenciar acento, por nome, slug e e-mail', async () => {
    await createBusiness(actor, base)
    await createBusiness(actor, { ...base, name: 'Estúdio Lua', slug: 'lua-nova', owner: { name: 'Maria', email: 'maria@exemplo.test' } })
    const slugs = async (search: string) => (await listBusinesses(actor, { search })).items.map((i) => i.slug)
    expect(await slugs('joao')).toEqual(['central'])
    expect(await slugs('JOÃO')).toEqual(['central'])
    expect(await slugs('estudio')).toEqual(['lua-nova'])
    expect(await slugs('lua-n')).toEqual(['lua-nova'])
    expect(await slugs('maria@exemplo')).toEqual(['lua-nova'])
    expect(await slugs('inexistente')).toEqual([])
    expect(await slugs('%')).toEqual([])
  })

  test('a busca por dono só olha vínculos ativos', async () => {
    const r = await createBusiness(actor, base)
    await prisma.membership.updateMany({ where: { businessId: r.business.id, userId: r.owner.userId }, data: { active: false } })
    expect((await listBusinesses(actor, { search: 'joao' })).items).toEqual([])
    expect((await listBusinesses(actor, { search: 'joao@exemplo' })).items).toEqual([])
    expect((await listBusinesses(actor, { search: 'central' })).items).toHaveLength(1)
  })

  test('filtra por situação e devolve a linha com dono e link de entrada', async () => {
    const a = await createBusiness(actor, base)
    await setBusinessStatus(actor, a.business.id, 'SUSPENDED', { confirmName: 'Barbearia Central' })
    await createBusiness(actor, { ...base, slug: 'outra', owner: { name: 'Z', email: 'z@exemplo.test' } })
    const ativas = await listBusinesses(actor, { status: 'ACTIVE' })
    expect(ativas.items.map((i) => i.slug)).toEqual(['outra'])
    const susp = await listBusinesses(actor, { status: 'SUSPENDED' })
    expect(susp.items[0]).toMatchObject({ slug: 'central', status: 'SUSPENDED', ownerName: 'João Silva', entryUrl: 'http://painel.localhost:3000/entrar/central' })
  })

  test('paginação por cursor é estável: sem repetir nem perder, e o último não tem cursor', async () => {
    const criadas: string[] = []
    for (let n = 0; n < 5; n++) criadas.push((await makeBusiness()).slug)
    const vistas: string[] = []
    let cursor: string | undefined
    for (let volta = 0; volta < 10; volta++) {
      const p = await listBusinesses(actor, { limit: 2, ...(cursor ? { cursor } : {}) })
      vistas.push(...p.items.map((i) => i.slug))
      if (p.nextCursor === null) break
      cursor = p.nextCursor
    }
    expect([...vistas].sort()).toEqual([...criadas].sort())
    expect(new Set(vistas).size).toBe(5)
  })

  test('cursor adulterado é erro de validação, não erro de banco', async () => {
    const e = await domainError(listBusinesses(actor, { cursor: 'lixo' }))
    expect(e.code).toBe('validation')
  })

  test('detalhe devolve dados, versão e módulos; id inexistente é not_found', async () => {
    const r = await createBusiness(actor, { ...base, legalName: 'Central LTDA', contactEmail: 'contato@central.test', contactPhone: '5592999990000', internalNotes: 'nota' })
    const d = await getBusinessDetail(actor, r.business.id)
    expect(d).toMatchObject({ legalName: 'Central LTDA', contactEmail: 'contato@central.test', contactPhone: '5592999990000', internalNotes: 'nota', version: 1, timeZone: 'America/Manaus' })
    expect((await domainError(getBusinessDetail(actor, UUID_INEXISTENTE))).code).toBe('not_found')
    expect((await domainError(getBusinessDetail(actor, 'nao-e-uuid'))).code).toBe('not_found')
  })
})

describe('updateBusinessData', () => {
  test('grava, incrementa a versão e devolve o novo link quando o slug muda', async () => {
    const r = await createBusiness(actor, base)
    const d = await updateBusinessData(actor, r.business.id, 1, { name: 'Central Nova', slug: 'central-nova', legalName: 'CN LTDA' })
    expect(d).toMatchObject({ name: 'Central Nova', slug: 'central-nova', legalName: 'CN LTDA', version: 2 })
    expect(d.entryUrl).toBe('http://painel.localhost:3000/entrar/central-nova')
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { action: 'business.updated' } })
    expect(linha.actorId).toBe(adminId)
    expect(linha.metadata).toMatchObject({ fields: ['legalName', 'name', 'slug'] })
  })

  test('campo ausente fica como está; null limpa o campo', async () => {
    const r = await createBusiness(actor, { ...base, legalName: 'A', internalNotes: 'N' })
    const d = await updateBusinessData(actor, r.business.id, 1, { internalNotes: null })
    expect(d.internalNotes).toBeNull()
    expect(d.legalName).toBe('A')
    expect(d.name).toBe('Barbearia Central')
  })

  test('versão antiga: conflict stale_version e nada muda', async () => {
    const r = await createBusiness(actor, base)
    await updateBusinessData(actor, r.business.id, 1, { name: 'Primeira' })
    const e = await domainError(updateBusinessData(actor, r.business.id, 1, { name: 'Segunda' }))
    expect(e).toMatchObject({ code: 'conflict', reason: 'stale_version' })
    const atual = await prisma.business.findUniqueOrThrow({ where: { id: r.business.id } })
    expect(atual).toMatchObject({ name: 'Primeira', version: 2 })
    expect(await prisma.auditLog.count({ where: { action: 'business.updated' } })).toBe(1)
  })

  test('duas edições simultâneas com a mesma versão: uma passa, a outra recebe o conflito', async () => {
    const r = await createBusiness(actor, base)
    const res = await Promise.allSettled([
      updateBusinessData(actor, r.business.id, 1, { name: 'A' }),
      updateBusinessData(actor, r.business.id, 1, { name: 'B' }),
    ])
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    const rej = res.find((x): x is PromiseRejectedResult => x.status === 'rejected')
    expect(rej?.reason).toMatchObject({ code: 'conflict', reason: 'stale_version' })
    expect((await prisma.business.findUniqueOrThrow({ where: { id: r.business.id } })).version).toBe(2)
  })

  test('slug já usado, reservado ou documento e e-mail inválidos: validation e nada muda', async () => {
    const a = await createBusiness(actor, base)
    await createBusiness(actor, { ...base, slug: 'outra', owner: { name: 'O', email: 'o@exemplo.test' } })
    const casos = [
      [{ slug: 'outra' }, 'slug'],
      [{ slug: 'painel' }, 'slug'],
      [{ document: '11222333000199' }, 'document'],
      [{ contactEmail: 'ruim' }, 'contactEmail'],
    ] as const
    for (const [patch, campo] of casos) {
      const e = await domainError(updateBusinessData(actor, a.business.id, 1, patch))
      expect(e.code).toBe('validation')
      expect(e.fields).toHaveProperty(campo)
    }
    expect((await prisma.business.findUniqueOrThrow({ where: { id: a.business.id } })).version).toBe(1)
  })

  test('conta inexistente é not_found', async () => {
    const e = await domainError(updateBusinessData(actor, UUID_INEXISTENTE, 1, { name: 'X' }))
    expect(e.code).toBe('not_found')
  })

  test('patch vazio não mexe na versão', async () => {
    const r = await createBusiness(actor, base)
    const d = await updateBusinessData(actor, r.business.id, 1, {})
    expect(d.version).toBe(1)
  })
})

describe('setBusinessStatus', () => {
  const confirm = { confirmName: 'Barbearia Central' }
  const futuro = () => new Date(Date.now() + 3_600_000)

  test('confirmName diferente do nome da conta falha e nada muda', async () => {
    const r = await createBusiness(actor, base)
    const e = await domainError(setBusinessStatus(actor, r.business.id, 'SUSPENDED', { confirmName: 'barbearia' }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('confirmName')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: r.business.id } })).status).toBe('ACTIVE')
  })

  test('suspender revoga as sessões do painel dos membros daquela conta e só delas', async () => {
    const r = await createBusiness(actor, base)
    const outra = await makeBusiness()
    const membro = await makeUser()
    await makeMembership(r.business.id, membro.id, 'MANAGER')
    const sess = (userId: string, activeBusinessId: string | null, tokenHash: string) =>
      prisma.session.create({ data: { userId, activeBusinessId, tokenHash, expiresAt: futuro() } })
    const dentro = await sess(membro.id, r.business.id, 'h1')
    const dono = await sess(r.owner.userId, r.business.id, 'h2')
    const multi = await makeUser()
    await makeMembership(r.business.id, multi.id, 'MANAGER')
    await makeMembership(outra.id, multi.id, 'MANAGER')
    const emOutra = await sess(multi.id, outra.id, 'h3')
    const estranho = await makeUser()
    const deEstranho = await sess(estranho.id, outra.id, 'h4')

    const d = await setBusinessStatus(actor, r.business.id, 'SUSPENDED', confirm)
    expect(d.status).toBe('SUSPENDED')
    const revogada = async (id: string) => (await prisma.session.findUniqueOrThrow({ where: { id } })).revokedAt !== null
    expect(await revogada(dentro.id)).toBe(true)
    expect(await revogada(dono.id)).toBe(true)
    expect(await revogada(emOutra.id)).toBe(false)
    expect(await revogada(deEstranho.id)).toBe(false)
  })

  test('revoga toda sessão com a conta ativa, inclusive a sem usuário (suporte)', async () => {
    const r = await createBusiness(actor, base)
    const suporte = await prisma.session.create({ data: { userId: null, impersonatorAdminId: adminId, activeBusinessId: r.business.id, tokenHash: 'sup', expiresAt: futuro() } })
    const fora = await makeUser()
    const deFora = await prisma.session.create({ data: { userId: fora.id, activeBusinessId: r.business.id, tokenHash: 'fora', expiresAt: futuro() } })
    await setBusinessStatus(actor, r.business.id, 'SUSPENDED', confirm)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporte.id } })).revokedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: deFora.id } })).revokedAt).not.toBeNull()
  })

  test('transições válidas: ACTIVE e SUSPENDED nos dois sentidos, qualquer uma para ARCHIVED, ARCHIVED para ACTIVE', async () => {
    const r = await createBusiness(actor, base)
    const id = r.business.id
    expect((await setBusinessStatus(actor, id, 'SUSPENDED', confirm)).status).toBe('SUSPENDED')
    expect((await setBusinessStatus(actor, id, 'ACTIVE', confirm)).status).toBe('ACTIVE')
    expect((await setBusinessStatus(actor, id, 'ARCHIVED', confirm)).status).toBe('ARCHIVED')
    expect((await setBusinessStatus(actor, id, 'ACTIVE', confirm)).status).toBe('ACTIVE')
    await setBusinessStatus(actor, id, 'SUSPENDED', confirm)
    expect((await setBusinessStatus(actor, id, 'ARCHIVED', confirm)).status).toBe('ARCHIVED')
  })

  test('transição inválida (ARCHIVED para SUSPENDED e para a mesma situação) falha com invalid_transition', async () => {
    const r = await createBusiness(actor, base)
    const id = r.business.id
    await setBusinessStatus(actor, id, 'ARCHIVED', confirm)
    const e = await domainError(setBusinessStatus(actor, id, 'SUSPENDED', confirm))
    expect(e).toMatchObject({ code: 'conflict', reason: 'invalid_transition' })
    const igual = await domainError(setBusinessStatus(actor, id, 'ARCHIVED', confirm))
    expect(igual.reason).toBe('invalid_transition')
  })

  test('reativar não revoga sessões; a auditoria registra de e para', async () => {
    const r = await createBusiness(actor, base)
    await setBusinessStatus(actor, r.business.id, 'SUSPENDED', confirm)
    const s = await prisma.session.create({ data: { userId: r.owner.userId, activeBusinessId: r.business.id, tokenHash: 'nova', expiresAt: futuro() } })
    await setBusinessStatus(actor, r.business.id, 'ACTIVE', confirm)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).revokedAt).toBeNull()
    const linhas = await prisma.auditLog.findMany({ where: { action: 'business.status_changed' }, orderBy: { createdAt: 'asc' } })
    expect(linhas).toHaveLength(2)
    expect(linhas[0]?.metadata).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED' })
    expect(linhas[0]?.actorId).toBe(adminId)
  })

  test('duas chamadas iguais ao mesmo tempo: uma passa e só uma auditoria é gravada', async () => {
    const r = await createBusiness(actor, base)
    const res = await Promise.allSettled([
      setBusinessStatus(actor, r.business.id, 'SUSPENDED', confirm),
      setBusinessStatus(actor, r.business.id, 'SUSPENDED', confirm),
    ])
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.auditLog.count({ where: { action: 'business.status_changed' } })).toBe(1)
  })
})

describe('ator', () => {
  test('quem não é admin da plataforma recebe forbidden em todas as funções', async () => {
    const r = await createBusiness(actor, base)
    const id = r.business.id
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    const membro = { kind: 'member', userId: 'u', membershipId: 'm', name: 'M', role: 'OWNER' } as unknown as PlatformAdminActor
    for (const a of [intruso, membro]) {
      const chamadas = [
        listBusinesses(a),
        getBusinessDetail(a, id),
        createBusiness(a, { ...base, slug: 'nova' }),
        updateBusinessData(a, id, 1, { name: 'X' }),
        setBusinessStatus(a, id, 'SUSPENDED', { confirmName: 'Barbearia Central' }),
      ]
      for (const c of chamadas) expect((await domainError(c)).code).toBe('forbidden')
    }
    expect(await prisma.business.count()).toBe(1)
    expect(mail.sent).toHaveLength(1)
  })
})

describe('admin desativado com o objeto de ator antigo', () => {
  test('escritas relêem o admin na transação: forbidden e nada gravado', async () => {
    const r = await createBusiness(actor, base)
    await prisma.platformAdmin.update({ where: { id: adminId }, data: { active: false } })
    expect((await domainError(createBusiness(actor, { ...base, slug: 'nova', owner: { name: 'Outra Pessoa', email: 'outra@exemplo.test' } }))).code).toBe('forbidden')
    expect((await domainError(updateBusinessData(actor, r.business.id, r.business.version, { name: 'Novo Nome' }))).code).toBe('forbidden')
    expect((await domainError(setBusinessStatus(actor, r.business.id, 'SUSPENDED', { confirmName: 'Barbearia Central' }))).code).toBe('forbidden')
    expect(await prisma.business.count()).toBe(1)
    const atual = await prisma.business.findUniqueOrThrow({ where: { id: r.business.id } })
    expect(atual).toMatchObject({ name: 'Barbearia Central', status: 'ACTIVE' })
  })
})

describe('arquivar revoga o suporte', () => {
  const confirm = { confirmName: 'Barbearia Central' }
  const futuro = () => new Date(Date.now() + 3_600_000)
  test('suporte aberto em conta suspensa não sobrevive a arquivar e reativar', async () => {
    const r = await createBusiness(actor, base)
    const id = r.business.id
    await setBusinessStatus(actor, id, 'SUSPENDED', confirm)
    // Suporte aberto depois da suspensão (o suporte entra em conta suspensa).
    const suporte = await prisma.session.create({ data: { userId: null, impersonatorAdminId: adminId, activeBusinessId: id, tokenHash: 'sup-suspensa', expiresAt: futuro() } })
    await setBusinessStatus(actor, id, 'ARCHIVED', confirm)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporte.id } })).revokedAt).not.toBeNull()
    await setBusinessStatus(actor, id, 'ACTIVE', confirm)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: suporte.id } })).revokedAt).not.toBeNull()
  })
})

describe('getBusinessNames', () => {
  test('devolve o nome só das contas pedidas, mesmo com mais de 100 contas, e ignora ids inválidos', async () => {
    const contas = []
    for (let i = 0; i < 103; i++) contas.push(await makeBusiness({ name: `Conta ${i}` }))
    const ultima = contas[102]!
    const primeira = contas[0]!
    const nomes = await getBusinessNames(actor, [ultima.id, primeira.id, 'x', ultima.id])
    expect([...nomes.entries()].sort()).toEqual([[primeira.id, 'Conta 0'], [ultima.id, 'Conta 102']].sort())
    expect((await getBusinessNames(actor, [])).size).toBe(0)
  }, 60_000)

  test('exige admin da plataforma', async () => {
    const intruso = { kind: 'system' } as unknown as PlatformAdminActor
    expect((await domainError(getBusinessNames(intruso, []))).code).toBe('forbidden')
  })
})
