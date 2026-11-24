import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '@/server/db/client'
import {
  anonymizeCustomer,
  archiveCustomer,
  createCustomer,
  getCustomer,
  listCustomers,
  restoreCustomer,
  updateCustomer,
} from '@/server/domain/customers/customers'
import { bookAppointment } from '@/server/domain/scheduling/appointments'
import { createLocalDiskStorage } from '@/server/storage/local-disk'
import type { Storage } from '@/server/storage/storage'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeAppointment,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeMembership,
  makeProfessional,
  makeService,
  makeUpload,
  makeUser,
  memberOf,
} from '../setup/factories'

let storage: Storage
let dir: string

vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => storage }
})

beforeEach(async () => {
  await resetDb()
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-customers-'))
  storage = createLocalDiskStorage(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function ctxCliente(business: { id: string }, customerId: string, now?: Date) {
  return makeCtx(business, {
    actor: { kind: 'customer', customerId, name: 'Cliente' },
    ...(now ? { now } : {}),
  })
}

async function auditorias(businessId: string, action: string) {
  return prisma.auditLog.findMany({ where: { businessId, action } })
}

async function agendar(businessId: string, customerId: string) {
  const service = await makeService(businessId)
  const professional = await makeProfessional(businessId, { serviceIds: [service.id] })
  return prisma.appointment.create({
    data: {
      businessId,
      customerId,
      professionalId: professional.id,
      startsAt: new Date('2026-12-01T13:00:00Z'),
      endsAt: new Date('2026-12-01T13:30:00Z'),
      status: 'CONFIRMED',
      source: 'PANEL',
      totalCents: 5000,
      totalDurationMin: 30,
      createdByType: 'MEMBER',
    },
  })
}

describe('createCustomer e getCustomer', () => {
  test('cria normalizando contato e lê de volta', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await createCustomer(ctx, {
      name: '  Ana Souza ',
      email: '  Ana@Exemplo.COM ',
      phone: '(11) 91234-5678',
      birthDate: '1990-05-17',
      notes: 'Alérgica a perfume',
      isClubMember: true,
    })
    expect(c).toEqual({
      id: c.id,
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      phone: '5511912345678',
      phoneLabel: '(11) 91234-5678',
      avatarUrl: null,
      birthDate: '1990-05-17',
      notes: 'Alérgica a perfume',
      isClubMember: true,
      origin: 'PANEL',
      hasAccount: false,
      archived: false,
      createdAt: c.createdAt,
    })
    expect(await getCustomer(ctx, c.id)).toEqual(c)
    expect(await auditorias(b.id, 'customer.created')).toHaveLength(1)
  })

  test('campos opcionais vazios viram null', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await createCustomer(ctx, { name: 'Bia', email: ' ', phone: '', notes: '  ', birthDate: null })
    expect(c).toMatchObject({ email: null, phone: null, phoneLabel: null, notes: null, birthDate: null })
  })

  test('hasAccount vem da pessoa ligada e a view não vaza o hash da senha dela', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const pessoa = await makeUser({ password: 'senha-secreta-longa' })
    const c = await makeCustomer(b.id, { userId: pessoa.id, origin: 'APP' })
    const view = await getCustomer(ctx, c.id)
    expect(view.hasAccount).toBe(true)
    expect(view.origin).toBe('APP')
    expect(JSON.stringify(view)).not.toContain(pessoa.passwordHash ?? 'x')
  })

  test('entradas inválidas dão validation com o campo certo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const casos: [Record<string, unknown>, string][] = [
      [{ name: '  ' }, 'name'],
      [{ name: 'x'.repeat(121) }, 'name'],
      [{ email: 'ana' }, 'email'],
      [{ phone: '123' }, 'phone'],
      [{ notes: 'x'.repeat(2001) }, 'notes'],
      [{ birthDate: '2020-02-30' }, 'birthDate'],
      [{ birthDate: 'ontem' }, 'birthDate'],
    ]
    for (const [troca, campo] of casos) {
      const e = await domainError(createCustomer(ctx, { name: 'Ana', ...troca }))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {})).toContain(campo)
    }
    expect(await prisma.customer.count()).toBe(0)
  })

  test('data de nascimento no futuro (no fuso da conta) dá validation', async () => {
    const b = await makeBusiness()
    // 2026-11-17 01:00 UTC ainda é dia 16 em São Paulo
    const ctx = await makeCtx(b, { now: new Date('2026-11-17T01:00:00Z') })
    const e = await domainError(createCustomer(ctx, { name: 'Ana', birthDate: '2026-11-17' }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('birthDate')
    const ok = await createCustomer(ctx, { name: 'Ana', birthDate: '2026-11-16' })
    expect(ok.birthDate).toBe('2026-11-16')
  })

  test('e-mail repetido na conta dá conflict; em outra conta é aceito', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const ctxA = await makeCtx(a)
    const ctxB = await makeCtx(b)
    await createCustomer(ctxA, { name: 'Ana', email: 'ana@exemplo.com' })
    const e = await domainError(createCustomer(ctxA, { name: 'Outra', email: 'ANA@exemplo.com' }))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('email_taken')
    expect(e.fields).toHaveProperty('email')
    await createCustomer(ctxB, { name: 'Ana', email: 'ana@exemplo.com' })
  })

  test('duas criações simultâneas com o mesmo e-mail: uma passa, a outra dá email_taken', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const resultados = await Promise.allSettled(
      [1, 2, 3].map((n) => createCustomer(ctx, { name: `Ana ${n}`, email: 'corrida@exemplo.com' })),
    )
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of resultados) {
      if (r.status === 'rejected') {
        expect(r.reason).toMatchObject({ code: 'conflict', reason: 'email_taken' })
      }
    }
  })

  test('profissional lista e lê, mas não cria; o ator cliente não cria', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const c = await makeCustomer(b.id)
    expect((await domainError(createCustomer(prof, { name: 'X' }))).code).toBe('forbidden')
    expect((await getCustomer(prof, c.id)).id).toBe(c.id)
    expect((await listCustomers(prof)).items).toHaveLength(1)
    const cliente = await ctxCliente(b, c.id)
    expect((await domainError(createCustomer(cliente, { name: 'X' }))).code).toBe('forbidden')
  })

  test('id malformado ou de outra conta dá not_found', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const ctxA = await makeCtx(a)
    const deB = await makeCustomer(b.id)
    expect((await domainError(getCustomer(ctxA, 'nada'))).code).toBe('not_found')
    expect((await domainError(getCustomer(ctxA, deB.id))).code).toBe('not_found')
    expect((await domainError(updateCustomer(ctxA, deB.id, { name: 'X' }))).code).toBe('not_found')
    expect((await domainError(archiveCustomer(ctxA, deB.id))).code).toBe('not_found')
    expect((await domainError(restoreCustomer(ctxA, deB.id))).code).toBe('not_found')
    expect((await domainError(anonymizeCustomer(ctxA, deB.id))).code).toBe('not_found')
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: deB.id } })).name).toBe(deB.name)
  })
})

describe('listCustomers', () => {
  test('busca por nome, e-mail e dígitos do telefone, sem diferenciar maiúsculas', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const ana = await createCustomer(ctx, {
      name: 'Ana Souza',
      email: 'ana.souza@exemplo.com',
      phone: '(11) 91234-5678',
    })
    await createCustomer(ctx, { name: 'Bruno Lima', email: 'bruno@exemplo.com', phone: '(21) 98888-7777' })
    for (const termo of ['ana', 'ANA', 'souza@exempl', '91234', '(11) 91234', '  ana  ']) {
      const { items } = await listCustomers(ctx, { search: termo })
      expect(items.map((c) => c.id), termo).toEqual([ana.id])
    }
    expect((await listCustomers(ctx, { search: 'zzz' })).items).toHaveLength(0)
  })

  test('busca com menos de 2 caracteres é ignorada; com mais de 80 dá validation', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await makeCustomer(b.id, { name: 'Ana' })
    await makeCustomer(b.id, { name: 'Bruno' })
    expect((await listCustomers(ctx, { search: 'a' })).items).toHaveLength(2)
    expect((await listCustomers(ctx, { search: '   ' })).items).toHaveLength(2)
    expect((await domainError(listCustomers(ctx, { search: 'x'.repeat(81) }))).code).toBe('validation')
  })

  test('coringas do termo não funcionam como padrão', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await makeCustomer(b.id, { name: 'Ana' })
    expect((await listCustomers(ctx, { search: '%%' })).items).toHaveLength(0)
  })

  test('paginação com limit 2 sobre 5 clientes percorre todos sem repetir nem pular', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const nomes = ['Eva', 'Ana', 'Dani', 'Ana', 'Caio']
    for (const name of nomes) await makeCustomer(b.id, { name })
    const vistos: string[] = []
    let cursor: string | undefined
    let paginas = 0
    do {
      const page = await listCustomers(ctx, { limit: 2, ...(cursor ? { cursor } : {}) })
      vistos.push(...page.items.map((c) => c.id))
      cursor = page.nextCursor ?? undefined
      paginas += 1
    } while (cursor)
    expect(paginas).toBe(3)
    expect(new Set(vistos).size).toBe(5)
    const todos = await listCustomers(ctx, { limit: 100 })
    expect(vistos).toEqual(todos.items.map((c) => c.id))
    expect(todos.items.map((c) => c.name)).toEqual([...nomes].sort())
    expect(todos.nextCursor).toBeNull()
  })

  test('limit padrão 30, máximo 100, e valores inválidos dão validation', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await prisma.customer.createMany({
      data: Array.from({ length: 32 }, (_, i) => ({
        businessId: b.id,
        name: `Cliente ${String(i).padStart(2, '0')}`,
        origin: 'PANEL' as const,
      })),
    })
    const page = await listCustomers(ctx)
    expect(page.items).toHaveLength(30)
    expect(page.nextCursor).not.toBeNull()
    for (const limit of [0, 101, 1.5]) {
      expect((await domainError(listCustomers(ctx, { limit }))).code).toBe('validation')
    }
  })

  test('cursor inválido dá validation', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    for (const cursor of ['lixo', 'e30', Buffer.from('[1,2]').toString('base64url')]) {
      expect((await domainError(listCustomers(ctx, { cursor }))).code).toBe('validation')
    }
  })

  test('filtro de clube, arquivados e isolamento entre contas', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const ctx = await makeCtx(a)
    const socio = await makeCustomer(a.id, { name: 'Sócio', isClubMember: true })
    const comum = await makeCustomer(a.id, { name: 'Comum' })
    const arquivado = await makeCustomer(a.id, { name: 'Arquivado', archivedAt: new Date() })
    await makeCustomer(b.id, { name: 'De outra conta' })
    expect((await listCustomers(ctx)).items.map((c) => c.id)).toEqual([comum.id, socio.id])
    expect((await listCustomers(ctx, { clubOnly: true })).items.map((c) => c.id)).toEqual([socio.id])
    const todos = await listCustomers(ctx, { includeArchived: true })
    expect(todos.items.map((c) => c.id)).toEqual([arquivado.id, comum.id, socio.id])
    expect(todos.items.find((c) => c.id === arquivado.id)?.archived).toBe(true)
  })
})

describe('ator cliente', () => {
  test('lê o próprio cadastro sem observações, mas não o de outro, e não lista', async () => {
    const b = await makeBusiness()
    const a = await makeCustomer(b.id, { notes: 'Nota interna' })
    const outro = await makeCustomer(b.id)
    const ctx = await ctxCliente(b, a.id)
    const view = await getCustomer(ctx, a.id)
    expect(view.id).toBe(a.id)
    expect(view).not.toHaveProperty('notes')
    expect((await domainError(getCustomer(ctx, outro.id))).code).toBe('forbidden')
    expect((await domainError(listCustomers(ctx))).code).toBe('forbidden')
    expect((await domainError(archiveCustomer(ctx, a.id))).code).toBe('forbidden')
    expect((await domainError(restoreCustomer(ctx, a.id))).code).toBe('forbidden')
  })

  test('altera o próprio telefone; isClubMember e notes são recusados sem alterar nada', async () => {
    const b = await makeBusiness()
    const a = await makeCustomer(b.id, { notes: 'Nota interna' })
    const outro = await makeCustomer(b.id)
    const ctx = await ctxCliente(b, a.id)
    const novo = await updateCustomer(ctx, a.id, { phone: '+55 (11) 98765-4321' })
    expect(novo.phone).toBe('5511987654321')
    expect(novo).not.toHaveProperty('notes')
    for (const troca of [{ isClubMember: true }, { notes: 'x' }, { name: 'Novo', isClubMember: true }]) {
      expect((await domainError(updateCustomer(ctx, a.id, troca))).code).toBe('forbidden')
    }
    expect((await domainError(updateCustomer(ctx, outro.id, { name: 'X' }))).code).toBe('forbidden')
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })
    expect(depois).toMatchObject({ name: a.name, notes: 'Nota interna', isClubMember: false })
  })

  test('cliente anonimiza o próprio cadastro, não o de outro', async () => {
    const b = await makeBusiness()
    const a = await makeCustomer(b.id)
    const outro = await makeCustomer(b.id)
    const ctx = await ctxCliente(b, a.id)
    expect((await domainError(anonymizeCustomer(ctx, outro.id))).code).toBe('forbidden')
    await anonymizeCustomer(ctx, a.id)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).anonymizedAt).not.toBeNull()
  })
})

describe('updateCustomer', () => {
  test('altera só o enviado, grava auditoria com os nomes dos campos e aceita limpar', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await createCustomer(ctx, { name: 'Ana', email: 'ana@exemplo.com', phone: '11912345678', notes: 'n' })
    const u = await updateCustomer(ctx, c.id, { name: ' Ana Maria ', email: null, notes: '', isClubMember: true })
    expect(u).toMatchObject({
      name: 'Ana Maria',
      email: null,
      notes: null,
      isClubMember: true,
      phone: '5511912345678',
    })
    const logs = await auditorias(b.id, 'customer.updated')
    expect(logs).toHaveLength(1)
    expect(logs[0]?.metadata).toMatchObject({ fields: ['name', 'email', 'notes', 'isClubMember'] })
    expect(JSON.stringify(logs[0]?.metadata)).not.toContain('Maria')
  })

  test('manter o próprio e-mail não conflita; usar o de outro cliente dá conflict', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const a = await createCustomer(ctx, { name: 'Ana', email: 'ana@exemplo.com' })
    await createCustomer(ctx, { name: 'Bia', email: 'bia@exemplo.com' })
    await updateCustomer(ctx, a.id, { email: 'ANA@exemplo.com', name: 'Ana 2' })
    const e = await domainError(updateCustomer(ctx, a.id, { email: 'bia@exemplo.com' }))
    expect(e).toMatchObject({ code: 'conflict', reason: 'email_taken' })
    expect(e.fields).toHaveProperty('email')
  })

  test('profissional não altera', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const c = await makeCustomer(b.id)
    expect((await domainError(updateCustomer(prof, c.id, { name: 'X' }))).code).toBe('forbidden')
  })

  test('entrada inválida dá validation e não altera', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await makeCustomer(b.id)
    const e = await domainError(updateCustomer(ctx, c.id, { name: '' }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('name')
  })
})

describe('arquivar, restaurar e anonimizar', () => {
  test('arquivado some da lista, não pode ser alterado, e volta ao restaurar', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await makeCustomer(b.id)
    await archiveCustomer(ctx, c.id)
    await archiveCustomer(ctx, c.id)
    expect((await listCustomers(ctx)).items).toHaveLength(0)
    expect((await getCustomer(ctx, c.id)).archived).toBe(true)
    expect((await domainError(updateCustomer(ctx, c.id, { name: 'X' }))).code).toBe('conflict')
    expect(await auditorias(b.id, 'customer.archived')).toHaveLength(1)
    const r = await restoreCustomer(ctx, c.id)
    expect(r.archived).toBe(false)
    expect((await restoreCustomer(ctx, c.id)).archived).toBe(false)
    expect((await listCustomers(ctx)).items).toHaveLength(1)
    expect(await auditorias(b.id, 'customer.restored')).toHaveLength(1)
  })

  test('arquivar e restaurar exigem manage_clients', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const c = await makeCustomer(b.id)
    expect((await domainError(archiveCustomer(prof, c.id))).code).toBe('forbidden')
    expect((await domainError(restoreCustomer(prof, c.id))).code).toBe('forbidden')
    expect((await domainError(anonymizeCustomer(prof, c.id))).code).toBe('forbidden')
  })

  test('anonimizar zera os dados, mantém o agendamento e pode ser repetido', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b, { now: new Date('2026-11-16T15:00:00Z') })
    const upload = await makeUpload(b.id)
    await storage.put(upload.path, Buffer.from('foto'), 'image/png')
    const pessoa = await makeUser({ email: 'ana@exemplo.com' })
    const c = await makeCustomer(b.id, {
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      userId: pessoa.id,
      birthDate: new Date('1990-05-17T00:00:00Z'),
      notes: 'segredo',
      avatarUploadId: upload.id,
      isClubMember: true,
    })
    const ag = await agendar(b.id, c.id)
    await anonymizeCustomer(ctx, c.id)
    await anonymizeCustomer(ctx, c.id)
    const depois = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })
    expect(depois).toMatchObject({
      name: 'Cliente removido',
      email: null,
      phone: null,
      userId: null,
      linkedAt: null,
      avatarUploadId: null,
      searchName: 'cliente removido',
      birthDate: null,
      notes: null,
    })
    expect(await prisma.upload.findUnique({ where: { id: upload.id } })).toBeNull()
    expect(await storage.get(upload.path)).toBeNull()
    expect(depois.anonymizedAt).not.toBeNull()
    expect(depois.archivedAt).not.toBeNull()
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id } })).customerId).toBe(c.id)
    const logs = await auditorias(b.id, 'customer.anonymized')
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0]?.metadata)).not.toMatch(/Ana|ana@|segredo/)
    expect(logs[0]?.metadata).toMatchObject({ hadAvatar: true, canceledAppointments: 1 })
    expect(await auditorias(b.id, 'customer.avatar_file_orphaned')).toHaveLength(0)
  })

  test('se o arquivo da foto não sair do storage, o registro já saiu e a auditoria avisa', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const upload = await makeUpload(b.id)
    const c = await makeCustomer(b.id, { avatarUploadId: upload.id })
    storage = { ...storage, delete: () => Promise.reject(new Error('disco indisponível')) }
    await anonymizeCustomer(ctx, c.id)
    expect(await prisma.upload.findUnique({ where: { id: upload.id } })).toBeNull()
    const logs = await auditorias(b.id, 'customer.anonymized')
    expect(logs[0]?.metadata).toMatchObject({ hadAvatar: true })
    const orfas = await auditorias(b.id, 'customer.avatar_file_orphaned')
    expect(orfas).toHaveLength(1)
    expect(orfas[0]?.targetId).toBe(c.id)
  })

  test('sem foto, a auditoria registra hadAvatar falso', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await makeCustomer(b.id)
    await anonymizeCustomer(ctx, c.id)
    const logs = await auditorias(b.id, 'customer.anonymized')
    expect(logs[0]?.metadata).toMatchObject({ hadAvatar: false, canceledAppointments: 0 })
    expect(await auditorias(b.id, 'customer.avatar_file_orphaned')).toHaveLength(0)
  })

  test('anonimizado não pode ser restaurado nem alterado', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await makeCustomer(b.id)
    await anonymizeCustomer(ctx, c.id)
    const r = await domainError(restoreCustomer(ctx, c.id))
    expect(r.code).toBe('conflict')
    expect(r.message).toMatch(/a pedido do cliente/)
    const u = await domainError(updateCustomer(ctx, c.id, { name: 'X' }))
    expect(u.code).toBe('conflict')
    expect(u.message).toMatch(/a pedido do cliente/)
    expect((await getCustomer(ctx, c.id)).name).toBe('Cliente removido')
  })

  test('o e-mail de um cliente anonimizado fica livre para outro cadastro', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await createCustomer(ctx, { name: 'Ana', email: 'ana@exemplo.com' })
    await anonymizeCustomer(ctx, c.id)
    const novo = await createCustomer(ctx, { name: 'Ana 2', email: 'ana@exemplo.com' })
    expect(novo.email).toBe('ana@exemplo.com')
  })
})

describe('cliente com conta, avatar e busca avançada', () => {
  test('equipe não troca o e-mail de cliente com conta: "O e-mail é da conta do cliente."', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const pessoa = await makeUser({ email: 'ana@exemplo.com' })
    const c = await makeCustomer(b.id, { userId: pessoa.id })
    const erro = await domainError(updateCustomer(ctx, c.id, { email: 'outra@exemplo.com' }))
    expect(erro.code).toBe('validation')
    expect(erro.fields?.['email']).toBe('O e-mail é da conta do cliente.')
    // Repetir o mesmo e-mail não é troca; a pessoa e a cópia seguem iguais.
    await updateCustomer(ctx, c.id, { email: ' ANA@exemplo.com ', name: 'Ana 2' })
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).email).toBe('ana@exemplo.com')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pessoa.id } })).email).toBe('ana@exemplo.com')
  })

  test('equipe edita nome, telefone, nascimento, observações e clube do cliente com conta (só na loja)', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const pessoa = await makeUser({ name: 'Ana', phone: '5511911112222' })
    const c = await makeCustomer(b.id, { userId: pessoa.id, name: 'Ana' })
    const novo = await updateCustomer(ctx, c.id, { name: 'Ana da Loja', phone: '11 98888-7777', birthDate: '1990-05-17', notes: 'Prefere manhã', isClubMember: true })
    expect(novo).toMatchObject({ name: 'Ana da Loja', phoneLabel: '(11) 98888-7777', birthDate: '1990-05-17', notes: 'Prefere manhã', isClubMember: true, hasAccount: true })
    const depois = await prisma.user.findUniqueOrThrow({ where: { id: pessoa.id } })
    expect(depois).toMatchObject({ name: 'Ana', phone: '5511911112222' })
  })

  test('anonimizar desliga a pessoa (user_id e linked_at nulos) e a pessoa continua existindo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const pessoa = await makeUser()
    const c = await makeCustomer(b.id, { userId: pessoa.id })
    await anonymizeCustomer(ctx, c.id)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ userId: null, linkedAt: null, email: null })
    expect(await prisma.user.findUnique({ where: { id: pessoa.id } })).not.toBeNull()
  })

  test('avatarUrl vem do upload do avatar', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const upload = await makeUpload(b.id)
    const c = await makeCustomer(b.id, { avatarUploadId: upload.id })
    expect((await getCustomer(ctx, c.id)).avatarUrl).toBe(`/arquivos/${upload.path}`)
    expect((await listCustomers(ctx)).items[0]?.avatarUrl).toBe(`/arquivos/${upload.path}`)
  })

  test('busca por nome ignora acentos e maiúsculas, e o nome gravado acompanha as trocas', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const joao = await createCustomer(ctx, { name: 'João Silva' })
    const jose = await createCustomer(ctx, { name: 'José Alves' })
    const conceicao = await createCustomer(ctx, { name: 'Maria da Conceição' })
    const achar = async (search: string) => (await listCustomers(ctx, { search })).items.map((c) => c.id)
    expect(await achar('joao')).toEqual([joao.id])
    expect(await achar('JOÃO')).toEqual([joao.id])
    expect(await achar('jose')).toEqual([jose.id])
    expect(await achar('conceicao')).toEqual([conceicao.id])
    expect(await achar('Conceição')).toEqual([conceicao.id])
    await updateCustomer(ctx, joao.id, { name: 'Pedro Ávila' })
    expect(await achar('joao')).toEqual([])
    expect(await achar('avila')).toEqual([joao.id])
  })

  test('sublinhado do termo é literal', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const com = await createCustomer(ctx, { name: 'Com', email: 'ana_souza@exemplo.com' })
    await createCustomer(ctx, { name: 'Sem', email: 'anaxsouza@exemplo.com' })
    expect((await listCustomers(ctx, { search: 'ana_souza@' })).items.map((c) => c.id)).toEqual([com.id])
  })

  test('telefone só entra na busca se o termo parece telefone', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await createCustomer(ctx, { name: 'Zé', phone: '(11) 91985-0000', email: 'ze@exemplo.com' })
    const tel = await createCustomer(ctx, { name: 'Lia', phone: '(11) 91234-5678' })
    expect((await listCustomers(ctx, { search: 'joao1985@gmail' })).items).toHaveLength(0)
    expect((await listCustomers(ctx, { search: '(11) 91234' })).items.map((c) => c.id)).toEqual([tel.id])
  })

  test('busca combinada com clubOnly e includeArchived', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const socia = await makeCustomer(b.id, { name: 'Ana Sócia', isClubMember: true })
    await makeCustomer(b.id, { name: 'Ana Comum' })
    const arq = await makeCustomer(b.id, { name: 'Ana Arquivada', archivedAt: new Date() })
    const ids = async (q: Parameters<typeof listCustomers>[1]) => (await listCustomers(ctx, q)).items.map((c) => c.id)
    expect(await ids({ search: 'ana', clubOnly: true })).toEqual([socia.id])
    expect(await ids({ search: 'ana' })).toHaveLength(2)
    expect(await ids({ search: 'arquivada' })).toEqual([])
    expect(await ids({ search: 'arquivada', includeArchived: true })).toEqual([arq.id])
  })

  test('cursor de nome longo com caracteres de 3 bytes é aceito na página seguinte', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const longo = `M${'€'.repeat(119)}`
    await makeCustomer(b.id, { name: 'Aaa' })
    await makeCustomer(b.id, { name: longo })
    await makeCustomer(b.id, { name: 'Zzz' })
    const p1 = await listCustomers(ctx, { limit: 1 })
    const p2 = await listCustomers(ctx, { limit: 1, cursor: p1.nextCursor ?? '' })
    expect(p2.items[0]?.name).toBe(longo)
    expect(p2.nextCursor?.length).toBeGreaterThan(500)
    const p3 = await listCustomers(ctx, { limit: 1, cursor: p2.nextCursor ?? '' })
    expect(p3.items.map((c) => c.name)).toEqual(['Zzz'])
  })

  test('data de nascimento no futuro em updateCustomer dá validation', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b, { now: new Date('2026-11-16T15:00:00Z') })
    const c = await makeCustomer(b.id)
    const e = await domainError(updateCustomer(ctx, c.id, { birthDate: '2026-11-17' }))
    expect(e.code).toBe('validation')
    expect(e.fields).toHaveProperty('birthDate')
  })

  test('ator cliente mandando notes null recebe forbidden', async () => {
    const b = await makeBusiness()
    const c = await makeCustomer(b.id, { notes: 'interna' })
    const ctx = await ctxCliente(b, c.id)
    expect((await domainError(updateCustomer(ctx, c.id, { notes: null }))).code).toBe('forbidden')
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).notes).toBe('interna')
  })
})

describe('cliente com agendamentos futuros', () => {
  const AGORA = new Date('2026-11-16T15:00:00Z')
  const EM_2_DIAS = new Date('2026-11-18T13:00:00Z')
  const EM_3_DIAS = new Date('2026-11-19T13:00:00Z')

  async function cenario() {
    const b = await makeBusiness()
    const ctx = await makeCtx(b, { now: AGORA })
    const tosa = await makeService(b.id, { durationMin: 30 })
    const c = await makeCustomer(b.id)
    return { b, ctx, tosa, c }
  }

  test('arquivar com 2 agendamentos futuros recusa e diz quantos', async () => {
    const { b, ctx, tosa, c } = await cenario()
    const p1 = await makeProfessional(b.id, { serviceIds: [tosa.id] })
    const p2 = await makeProfessional(b.id, { serviceIds: [tosa.id] })
    await makeAppointment(b.id, { customerId: c.id, professionalId: p1.id, serviceId: tosa.id, startsAt: EM_2_DIAS, status: 'CONFIRMED' })
    await makeAppointment(b.id, { customerId: c.id, professionalId: p2.id, serviceId: tosa.id, startsAt: EM_3_DIAS, status: 'PENDING' })
    const e = await domainError(archiveCustomer(ctx, c.id))
    expect(e.code).toBe('conflict')
    expect(e.reason).toBe('has_future_appointments')
    expect(e.details?.count).toBe(2)
    expect(e.message).toContain('2')
    expect((await getCustomer(ctx, c.id)).archived).toBe(false)
  })

  test('arquivar só com agendamentos passados, cancelados ou concluídos funciona', async () => {
    const { b, ctx, tosa, c } = await cenario()
    const p = await makeProfessional(b.id, { serviceIds: [tosa.id] })
    const base = { customerId: c.id, professionalId: p.id, serviceId: tosa.id }
    await makeAppointment(b.id, { ...base, startsAt: new Date('2026-11-10T13:00:00Z'), status: 'CONFIRMED' })
    await makeAppointment(b.id, { ...base, startsAt: EM_2_DIAS, status: 'CANCELED' })
    await makeAppointment(b.id, { ...base, startsAt: EM_3_DIAS, status: 'NO_SHOW' })
    await archiveCustomer(ctx, c.id)
    expect((await getCustomer(ctx, c.id)).archived).toBe(true)
  })

  test('atendimento em andamento conta como futuro', async () => {
    const { b, ctx, tosa, c } = await cenario()
    const p = await makeProfessional(b.id, { serviceIds: [tosa.id] })
    await makeAppointment(b.id, {
      customerId: c.id,
      professionalId: p.id,
      serviceId: tosa.id,
      startsAt: new Date(AGORA.getTime() - 10 * 60_000),
      status: 'CONFIRMED',
    })
    const e = await domainError(archiveCustomer(ctx, c.id))
    expect(e.details?.count).toBe(1)
    await anonymizeCustomer(ctx, c.id)
    expect((await prisma.appointment.findFirstOrThrow({ where: { customerId: c.id } })).status).toBe('CANCELED')
  })

  test('anonimizar cancela os futuros de profissionais diferentes, libera o horário e avisa a equipe', async () => {
    const { b, ctx, tosa, c } = await cenario()
    const donoA = await makeUser()
    const donoB = await makeUser()
    const mA = await makeMembership(b.id, donoA.id, 'PROFESSIONAL')
    const mB = await makeMembership(b.id, donoB.id, 'PROFESSIONAL')
    const p1 = await makeProfessional(b.id, { serviceIds: [tosa.id], membershipId: mA.id })
    const p2 = await makeProfessional(b.id, { serviceIds: [tosa.id], membershipId: mB.id })
    const a1 = await bookAppointment(ctx, { customerId: c.id, professionalId: p1.id, serviceIds: [tosa.id], startsAt: EM_2_DIAS })
    const a2 = await bookAppointment(ctx, { customerId: c.id, professionalId: p2.id, serviceIds: [tosa.id], startsAt: EM_3_DIAS })
    const passado = await makeAppointment(b.id, {
      customerId: c.id,
      professionalId: p1.id,
      serviceId: tosa.id,
      startsAt: new Date('2026-11-10T13:00:00Z'),
      status: 'COMPLETED',
    })
    expect(await prisma.notification.count({ where: { customerId: c.id, status: 'PENDING' } })).toBeGreaterThan(0)

    await anonymizeCustomer(ctx, c.id)

    const depois = await prisma.appointment.findMany({ where: { customerId: c.id }, orderBy: { startsAt: 'asc' } })
    expect(depois.map((x) => x.status)).toEqual(['COMPLETED', 'CANCELED', 'CANCELED'])
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: passado.id } })).status).toBe('COMPLETED')
    for (const x of depois.filter((y) => y.status === 'CANCELED')) {
      expect(x.canceledAt).toEqual(AGORA)
      expect(x.canceledByType).toBe('MEMBER')
      expect(x.canceledById).toBe(memberOf(ctx).userId)
      expect(x.cancelReason).toBe('Cadastro removido a pedido do cliente.')
    }
    expect(await auditorias(b.id, 'appointment.canceled')).toHaveLength(2)
    // O cliente não recebe nada; os lembretes pendentes saem da fila.
    expect(await prisma.notification.count({ where: { customerId: c.id, status: 'PENDING' } })).toBe(0)
    expect(await prisma.notification.count({ where: { customerId: c.id, kind: 'APPOINTMENT_CANCELED' } })).toBe(0)
    // Cada profissional vinculado é avisado do seu agendamento.
    const avisos = await prisma.notification.findMany({ where: { kind: 'STAFF_APPOINTMENT_CANCELED' } })
    expect(new Set(avisos.map((n) => n.membershipId))).toEqual(new Set([mA.id, mB.id]))
    expect(new Set(avisos.map((n) => n.appointmentId))).toEqual(new Set([a1.id, a2.id]))
    // O horário ficou livre para outro cliente.
    const outro = await makeCustomer(b.id)
    await bookAppointment(ctx, { customerId: outro.id, professionalId: p1.id, serviceIds: [tosa.id], startsAt: EM_2_DIAS })
    const logs = await auditorias(b.id, 'customer.anonymized')
    expect(logs).toHaveLength(1)
    expect(logs[0]?.metadata).toMatchObject({ hadAvatar: false, canceledAppointments: 2 })
  })

  test('o próprio cliente que se anonimiza também cancela os futuros, sem prazo mínimo', async () => {
    const { b, tosa, c } = await cenario()
    const p = await makeProfessional(b.id, { serviceIds: [tosa.id] })
    const ag = await makeAppointment(b.id, {
      customerId: c.id,
      professionalId: p.id,
      serviceId: tosa.id,
      startsAt: new Date(AGORA.getTime() + 30 * 60_000),
      status: 'CONFIRMED',
    })
    await anonymizeCustomer(await ctxCliente(b, c.id, AGORA), c.id)
    const depois = await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id } })
    expect(depois.status).toBe('CANCELED')
    expect(depois.canceledByType).toBe('CUSTOMER')
  })
})
