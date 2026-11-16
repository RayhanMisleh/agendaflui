import { prisma } from '@/server/db/client'
import {
  archiveService,
  createService,
  getService,
  listServices,
  reorderServices,
  restoreService,
  updateService,
} from '@/server/domain/catalog/services'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeService } from '../setup/factories'

beforeEach(resetDb)

function ctxCliente(business: { id: string }) {
  return makeCtx(business, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'Cliente' } })
}

async function auditorias(businessId: string, action: string) {
  return prisma.auditLog.findMany({ where: { businessId, action } })
}

describe('createService e getService', () => {
  test('cria com os padrões e lê de volta', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const criado = await createService(ctx, {
      name: '  Banho e tosa  ',
      priceCents: 8000,
      durationMin: 45,
    })
    expect(criado).toEqual({
      id: criado.id,
      name: 'Banho e tosa',
      description: null,
      icon: 'sparkles',
      priceCents: 8000,
      durationMin: 45,
      rewardPoints: 0,
      clubOnly: false,
      active: true,
      displayOrder: 1,
      archived: false,
    })
    expect(await getService(ctx, criado.id)).toEqual(criado)
  })

  test('descrição vazia vira null e o próximo displayOrder segue o maior não arquivado', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await makeService(b.id, { displayOrder: 4 })
    await makeService(b.id, { displayOrder: 9, archivedAt: new Date() })
    const s = await createService(ctx, { name: 'Novo', description: '   ', priceCents: 0, durationMin: 5 })
    expect(s.description).toBeNull()
    expect(s.displayOrder).toBe(5)
  })

  test('entradas inválidas dão validation com o campo certo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const base = { name: 'Corte', priceCents: 5000, durationMin: 30 }
    const casos: [Record<string, unknown>, string][] = [
      [{ name: '   ' }, 'name'],
      [{ name: 'x'.repeat(81) }, 'name'],
      [{ durationMin: 7 }, 'durationMin'],
      [{ durationMin: 605 }, 'durationMin'],
      [{ priceCents: -1 }, 'priceCents'],
      [{ priceCents: 1.5 }, 'priceCents'],
      [{ rewardPoints: -1 }, 'rewardPoints'],
      [{ priceCents: 10_000_001 }, 'priceCents'],
      [{ rewardPoints: 100_001 }, 'rewardPoints'],
      [{ icon: '' }, 'icon'],
      [{ icon: 'x'.repeat(41) }, 'icon'],
      [{ description: 'x'.repeat(501) }, 'description'],
    ]
    for (const [troca, campo] of casos) {
      const e = await domainError(createService(ctx, { ...base, ...troca }))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {})).toContain(campo)
    }
    expect(await prisma.service.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('grava auditoria', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await createService(ctx, { name: 'Corte', priceCents: 5000, durationMin: 30 })
    const linhas = await auditorias(b.id, 'service.created')
    expect(linhas).toHaveLength(1)
    expect(linhas[0]?.targetType).toBe('Service')
    expect(linhas[0]?.targetId).toBe(s.id)
  })
})

describe('permissões', () => {
  test('profissional não cria nem altera, mas lista', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const s = await makeService(b.id)
    expect((await domainError(createService(prof, { name: 'X', priceCents: 1, durationMin: 5 }))).code).toBe('forbidden')
    expect((await domainError(updateService(prof, s.id, { name: 'Y' }))).code).toBe('forbidden')
    expect((await domainError(archiveService(prof, s.id))).code).toBe('forbidden')
    expect((await domainError(restoreService(prof, s.id))).code).toBe('forbidden')
    expect((await domainError(reorderServices(prof, [s.id]))).code).toBe('forbidden')
    expect((await listServices(prof)).map((x) => x.id)).toEqual([s.id])
  })

  test('ator cliente não cria', async () => {
    const b = await makeBusiness()
    const cliente = await ctxCliente(b)
    const e = await domainError(createService(cliente, { name: 'X', priceCents: 1, durationMin: 5 }))
    expect(e.code).toBe('forbidden')
  })

  test('gerente cria', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER')
    const s = await createService(gerente, { name: 'X', priceCents: 1, durationMin: 5 })
    expect(s.name).toBe('X')
  })

  test('cliente só vê serviço ativo e não arquivado, mesmo pedindo o contrário', async () => {
    const b = await makeBusiness()
    const cliente = await ctxCliente(b)
    const ativo = await makeService(b.id)
    const inativo = await makeService(b.id, { active: false })
    const arquivado = await makeService(b.id, { archivedAt: new Date() })
    const lista = await listServices(cliente, { includeInactive: true, includeArchived: true })
    expect(lista.map((x) => x.id)).toEqual([ativo.id])
    expect((await getService(cliente, ativo.id)).id).toBe(ativo.id)
    expect((await domainError(getService(cliente, inativo.id))).code).toBe('not_found')
    expect((await domainError(getService(cliente, arquivado.id))).code).toBe('not_found')
  })
})

describe('serviço de outra conta', () => {
  test('dá not_found em get, update, archive, restore e reorder não o inclui', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    const ctxA = await makeCtx(a)
    const deB = await makeService(b.id)
    expect((await domainError(getService(ctxA, deB.id))).code).toBe('not_found')
    expect((await domainError(updateService(ctxA, deB.id, { name: 'Invadido' }))).code).toBe('not_found')
    expect((await domainError(archiveService(ctxA, deB.id))).code).toBe('not_found')
    expect((await domainError(restoreService(ctxA, deB.id))).code).toBe('not_found')
    expect((await domainError(reorderServices(ctxA, [deB.id]))).code).toBe('validation')
    const intacto = await prisma.service.findUniqueOrThrow({ where: { id: deB.id } })
    expect(intacto.name).toBe(deB.name)
    expect(intacto.archivedAt).toBeNull()
  })

  test('id malformado dá not_found', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect((await domainError(getService(ctx, 'abc'))).code).toBe('not_found')
    expect((await domainError(updateService(ctx, 'abc', { name: 'x' }))).code).toBe('not_found')
    expect((await domainError(archiveService(ctx, 'abc'))).code).toBe('not_found')
    expect((await domainError(restoreService(ctx, 'abc'))).code).toBe('not_found')
  })
})

describe('listServices', () => {
  test('ordena por displayOrder e depois por nome; inativos só com includeInactive', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const c = await makeService(b.id, { name: 'C', displayOrder: 1 })
    const a = await makeService(b.id, { name: 'A', displayOrder: 2 })
    const bb = await makeService(b.id, { name: 'B', displayOrder: 2 })
    const off = await makeService(b.id, { name: 'Off', displayOrder: 0, active: false })
    expect((await listServices(ctx)).map((x) => x.id)).toEqual([c.id, a.id, bb.id])
    expect((await listServices(ctx, { includeInactive: true })).map((x) => x.id)).toEqual([off.id, c.id, a.id, bb.id])
  })
})

describe('updateService', () => {
  test('altera só os campos enviados e audita', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id, { description: 'antiga' })
    const novo = await updateService(ctx, s.id, { priceCents: 9900, description: null })
    expect(novo.priceCents).toBe(9900)
    expect(novo.description).toBeNull()
    expect(novo.name).toBe(s.name)
    expect(await auditorias(b.id, 'service.updated')).toHaveLength(1)
  })

  test('corpo vazio devolve o serviço sem alterar nem auditar', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id)
    const antes = await getService(ctx, s.id)
    expect(await updateService(ctx, s.id, {})).toEqual(antes)
    expect(await auditorias(b.id, 'service.updated')).toHaveLength(0)
  })

  test('valida os campos enviados', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id)
    const e = await domainError(updateService(ctx, s.id, { durationMin: 7 }))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toEqual(['durationMin'])
  })

  test('serviço arquivado não pode ser alterado', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id, { archivedAt: new Date() })
    const e = await domainError(updateService(ctx, s.id, { name: 'Novo nome' }))
    expect(e.code).toBe('conflict')
    expect(e.message).toContain('Restaure')
  })
})

describe('archiveService e restoreService', () => {
  test('arquivar some da lista padrão, aparece com includeArchived e restaurar volta', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id)
    await archiveService(ctx, s.id)
    expect(await listServices(ctx)).toEqual([])
    const arquivados = await listServices(ctx, { includeArchived: true })
    expect(arquivados.map((x) => [x.id, x.archived])).toEqual([[s.id, true]])
    const volta = await restoreService(ctx, s.id)
    expect(volta.archived).toBe(false)
    expect((await listServices(ctx)).map((x) => x.id)).toEqual([s.id])
    expect(await auditorias(b.id, 'service.archived')).toHaveLength(1)
    expect(await auditorias(b.id, 'service.restored')).toHaveLength(1)
  })

  test('arquivar de novo ou restaurar um serviço ativo é idempotente e não audita de novo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s = await makeService(b.id)
    await restoreService(ctx, s.id)
    expect(await auditorias(b.id, 'service.restored')).toHaveLength(0)
    await archiveService(ctx, s.id)
    await archiveService(ctx, s.id)
    expect(await auditorias(b.id, 'service.archived')).toHaveLength(1)
  })

  test('restaurar põe o serviço no fim da lista', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const velho = await makeService(b.id, { displayOrder: 1, archivedAt: new Date() })
    const outro = await makeService(b.id, { displayOrder: 2 })
    const volta = await restoreService(ctx, velho.id)
    expect(volta.displayOrder).toBe(3)
    expect((await listServices(ctx)).map((x) => x.id)).toEqual([outro.id, velho.id])
  })
})

describe('reorderServices', () => {
  test('lista incompleta, com sobra ou repetida dá validation', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s1 = await makeService(b.id, { displayOrder: 1 })
    const s2 = await makeService(b.id, { displayOrder: 2 })
    const arq = await makeService(b.id, { displayOrder: 3, archivedAt: new Date() })
    for (const ids of [[s1.id], [s1.id, s2.id, arq.id], [s1.id, s1.id], [s1.id, 'abc']]) {
      expect((await domainError(reorderServices(ctx, ids))).code).toBe('validation')
    }
    expect((await listServices(ctx)).map((x) => x.id)).toEqual([s1.id, s2.id])
  })

  test('entrada que não é lista dá erro em orderedIds', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    // @ts-expect-error entrada inválida de propósito
    const e = await domainError(reorderServices(ctx, 'abc'))
    expect(e.code).toBe('validation')
    expect(Object.keys(e.fields ?? {})).toEqual(['orderedIds'])
  })

  test('lista vazia numa conta sem serviços não grava nem audita', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await reorderServices(ctx, [])
    expect(await auditorias(b.id, 'service.reordered')).toHaveLength(0)
  })

  test('lista completa muda a ordem e audita', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const s1 = await makeService(b.id, { displayOrder: 1 })
    const s2 = await makeService(b.id, { displayOrder: 2 })
    const s3 = await makeService(b.id, { displayOrder: 3 })
    await reorderServices(ctx, [s3.id, s1.id, s2.id])
    expect((await listServices(ctx)).map((x) => [x.id, x.displayOrder])).toEqual([
      [s3.id, 1],
      [s1.id, 2],
      [s2.id, 3],
    ])
    expect(await auditorias(b.id, 'service.reordered')).toHaveLength(1)
  })
})
