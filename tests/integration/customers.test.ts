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
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeBusiness,
  makeCtx,
  makeCustomer,
  makeProfessional,
  makeService,
} from '../setup/factories'

beforeEach(resetDb)

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
      hasAppAccess: false,
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

  test('hasAppAccess vem da senha e a view não vaza o hash', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await makeCustomer(b.id, { passwordHash: 'hash-secreto', origin: 'APP' })
    const view = await getCustomer(ctx, c.id)
    expect(view.hasAppAccess).toBe(true)
    expect(view.origin).toBe('APP')
    expect(JSON.stringify(view)).not.toContain('hash-secreto')
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
    expect(view.notes).toBeNull()
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
    expect(novo.notes).toBeNull()
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
    const ctx = await makeCtx(b)
    const upload = await prisma.upload.create({
      data: { businessId: b.id, path: 'uploads/a.png', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, createdByType: 'SYSTEM' },
    })
    const c = await makeCustomer(b.id, {
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      passwordHash: 'hash',
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
      passwordHash: null,
      avatarUploadId: null,
      birthDate: null,
      notes: null,
    })
    expect(depois.anonymizedAt).not.toBeNull()
    expect(depois.archivedAt).not.toBeNull()
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: ag.id } })).customerId).toBe(c.id)
    const logs = await auditorias(b.id, 'customer.anonymized')
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0]?.metadata)).not.toMatch(/Ana|ana@|segredo/)
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
