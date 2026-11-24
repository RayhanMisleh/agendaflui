import sharp from 'sharp'
import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { getRanking } from '@/server/domain/loyalty/ranking'
import { archivePrize, createPrize, getPrize, listPrizes, movePrize, setPrizeImage, updatePrize } from '@/server/domain/loyalty/prizes'
import { getLoyaltySettings, updateLoyaltySettings } from '@/server/domain/loyalty/settings'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { makeBusiness, makeCtx, makeCustomer } from '../setup/factories'
import { AGORA, cenaFidelidade, lancar } from '../setup/loyalty'

beforeEach(resetDb)

const novo = (name: string, o: Partial<{ costPoints: number; stock: number | null; active: boolean }> = {}) => ({
  name,
  description: null,
  costPoints: o.costPoints ?? 50,
  stock: o.stock === undefined ? null : o.stock,
  active: o.active ?? true,
})

describe('prêmios', () => {
  test('cria com a ordem seguinte, lista na ordem e devolve a visão', async () => {
    const s = await cenaFidelidade()
    const a = await createPrize(s.dono, { ...novo('Corte'), description: '  Corte simples  ' })
    const b = await createPrize(s.gerente, novo('Barba', { stock: 4 }))
    expect(a).toMatchObject({ name: 'Corte', description: 'Corte simples', costPoints: 50, stock: null, active: true, displayOrder: 1, imageUrl: null, archivedAt: null })
    expect(b.displayOrder).toBe(2)
    expect((await listPrizes(s.dono)).map((p) => p.name)).toEqual(['Corte', 'Barba'])
    expect((await getPrize(s.dono, b.id)).stock).toBe(4)
    expect(await prisma.auditLog.count({ where: { businessId: s.b.id, action: 'prize.created' } })).toBe(2)
  })

  test('validação: nome, custo, estoque e descrição', async () => {
    const s = await cenaFidelidade()
    const tenta = (o: Record<string, unknown>) => domainError(createPrize(s.dono, { ...novo('X'), ...o } as never))
    expect((await tenta({ name: '  ' })).fields).toHaveProperty('name')
    expect((await tenta({ name: 'x'.repeat(81) })).fields).toHaveProperty('name')
    expect((await tenta({ costPoints: 0 })).fields).toHaveProperty('costPoints')
    expect((await tenta({ costPoints: 1.5 })).fields).toHaveProperty('costPoints')
    expect((await tenta({ stock: -1 })).fields).toHaveProperty('stock')
    expect((await tenta({ description: 'x'.repeat(501) })).fields).toHaveProperty('description')
    expect(await prisma.prize.count()).toBe(0)
  })

  test('profissional não gerencia (forbidden) e o módulo desligado recusa', async () => {
    const s = await cenaFidelidade()
    expect((await domainError(createPrize(s.profissional, novo('X')))).code).toBe('forbidden')
    expect((await domainError(listPrizes(s.profissional))).code).toBe('forbidden')
    const off = await cenaFidelidade({ modulo: false })
    expect((await domainError(createPrize(off.dono, novo('X')))).code).toBe('module_disabled')
  })

  test('atualiza parcialmente, inclusive o estoque para sem limite, e audita', async () => {
    const s = await cenaFidelidade()
    const p = await createPrize(s.dono, novo('Corte', { stock: 3 }))
    const u = await updatePrize(s.dono, p.id, { stock: null, costPoints: 80 })
    expect(u).toMatchObject({ name: 'Corte', stock: null, costPoints: 80 })
    expect((await updatePrize(s.dono, p.id, { active: false })).active).toBe(false)
    expect((await domainError(updatePrize(s.dono, p.id, { costPoints: -1 }))).code).toBe('validation')
    expect((await domainError(updatePrize(s.dono, '0b8e2f47-3d19-4a5c-8e60-71c2d9a4f3b8', { name: 'Y' }))).code).toBe('not_found')
    expect(await prisma.auditLog.count({ where: { businessId: s.b.id, action: 'prize.updated' } })).toBe(2)
  })

  test('arquivar tira da lista comum e some da vitrine do cliente; includeArchived mostra', async () => {
    const s = await cenaFidelidade()
    const p = await createPrize(s.dono, novo('Corte'))
    await createPrize(s.dono, novo('Barba'))
    await archivePrize(s.dono, p.id)
    await archivePrize(s.dono, p.id)
    expect((await listPrizes(s.dono)).map((x) => x.name)).toEqual(['Barba'])
    expect((await listPrizes(s.dono, { includeArchived: true })).map((x) => x.name)).toEqual(['Corte', 'Barba'])
    expect((await getPrize(s.dono, p.id)).archivedAt).toEqual(AGORA)
  })

  test('o cliente só vê ativos, não arquivados e com estoque diferente de zero', async () => {
    const s = await cenaFidelidade()
    await createPrize(s.dono, novo('Visível', { stock: 2 }))
    await createPrize(s.dono, novo('Sem limite'))
    await createPrize(s.dono, novo('Esgotado', { stock: 0 }))
    await createPrize(s.dono, novo('Inativo', { active: false }))
    const velho = await createPrize(s.dono, novo('Arquivado'))
    await archivePrize(s.dono, velho.id)
    const vistos = await listPrizes(s.ctxCliente, { includeInactive: true, includeArchived: true })
    expect(vistos.map((p) => p.name)).toEqual(['Visível', 'Sem limite'])
    expect((await listPrizes(s.dono, { includeInactive: true })).map((p) => p.name)).toEqual(['Visível', 'Sem limite', 'Esgotado', 'Inativo'])
  })

  test('mover sobe e desce, e nas pontas não faz nada', async () => {
    const s = await cenaFidelidade()
    const [a, b, c] = [await createPrize(s.dono, novo('A')), await createPrize(s.dono, novo('B')), await createPrize(s.dono, novo('C'))]
    const nomes = async () => (await listPrizes(s.dono)).map((p) => p.name).join('')
    await movePrize(s.dono, c.id, 'up')
    expect(await nomes()).toBe('ACB')
    await movePrize(s.dono, a.id, 'down')
    expect(await nomes()).toBe('CAB')
    await movePrize(s.dono, c.id, 'up')
    await movePrize(s.dono, b.id, 'down')
    expect(await nomes()).toBe('CAB')
  })

  test('um prêmio de outra conta é not_found', async () => {
    const s = await cenaFidelidade()
    const p = await createPrize(s.dono, novo('Corte'))
    const b2 = await makeBusiness()
    await prisma.businessModules.update({ where: { businessId: b2.id }, data: { loyalty: true } })
    const ctxB = await makeCtx(b2)
    for (const op of [getPrize(ctxB, p.id), updatePrize(ctxB, p.id, { name: 'Z' }), archivePrize(ctxB, p.id), movePrize(ctxB, p.id, 'up')]) {
      expect((await domainError(op)).code).toBe('not_found')
    }
    expect((await listPrizes(ctxB))).toEqual([])
  })

  test('imagem: grava, troca (apaga a antiga) e remove', async () => {
    const s = await cenaFidelidade()
    const p = await createPrize(s.dono, novo('Corte'))
    const png = async (cor: string) => ({ bytes: new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: cor } }).png().toBuffer()) })
    const a = await setPrizeImage(s.dono, p.id, await png('#aa0000'))
    expect(a.imageUrl).toMatch(/^\/arquivos\//)
    const primeira = await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })
    await setPrizeImage(s.dono, p.id, await png('#00aa00'))
    expect(await prisma.upload.findUnique({ where: { id: primeira.imageUploadId as string } })).toBeNull()
    expect((await setPrizeImage(s.dono, p.id, null)).imageUrl).toBeNull()
    expect(await prisma.upload.count({ where: { businessId: s.b.id } })).toBe(0)
    expect((await domainError(setPrizeImage(s.dono, p.id, { bytes: new Uint8Array([1, 2, 3]) }))).code).toBe('validation')
    expect((await domainError(setPrizeImage(s.profissional, p.id, null))).code).toBe('forbidden')
  })

  test('para o app a imagem vem com o endereço absoluto da API', async () => {
    const s = await cenaFidelidade()
    const p = await createPrize(s.dono, novo('Corte'))
    const bytes = new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: '#123456' } }).png().toBuffer())
    await setPrizeImage(s.dono, p.id, { bytes })
    const [visto] = await listPrizes(s.ctxCliente)
    expect(visto?.imageUrl).toMatch(/\/arquivos\//)
    expect(visto?.imageUrl?.startsWith('http')).toBe(true)
  })
})

describe('configuração', () => {
  test('lê o padrão, grava com a versão e recusa versão velha', async () => {
    const s = await cenaFidelidade()
    const antes = await getLoyaltySettings(s.dono)
    expect(antes.rankingEnabled).toBe(false)
    const depois = await updateLoyaltySettings(s.dono, antes.version, { rankingEnabled: true })
    expect(depois).toEqual({ rankingEnabled: true, version: antes.version + 1 })
    expect((await domainError(updateLoyaltySettings(s.dono, antes.version, { rankingEnabled: false }))).reason).toBe('stale_version')
    expect((await getLoyaltySettings(s.dono)).rankingEnabled).toBe(true)
    expect(await prisma.auditLog.count({ where: { businessId: s.b.id, action: 'loyalty.settings_updated' } })).toBe(1)
  })

  test('profissional e módulo desligado recusam', async () => {
    const s = await cenaFidelidade()
    expect((await domainError(updateLoyaltySettings(s.profissional, 1, { rankingEnabled: true }))).code).toBe('forbidden')
    expect((await domainError(getLoyaltySettings(s.profissional))).code).toBe('forbidden')
    const off = await cenaFidelidade({ modulo: false })
    expect((await domainError(getLoyaltySettings(off.dono))).code).toBe('module_disabled')
  })
})

describe('ranking', () => {
  async function ligar(s: Awaited<ReturnType<typeof cenaFidelidade>>) {
    const cfg = await getLoyaltySettings(s.dono)
    await updateLoyaltySettings(s.dono, cfg.version, { rankingEnabled: true })
  }
  const earn = (s: Awaited<ReturnType<typeof cenaFidelidade>>, id: string, pts: number, quando: Date = AGORA) =>
    lancar(s.b.id, id, pts, { kind: pts > 0 ? 'EARN' : 'EARN_REVERSAL', createdAt: quando })

  test('desligado devolve enabled false e lista vazia, mesmo com pontos', async () => {
    const s = await cenaFidelidade()
    await earn(s, s.cliente.id, 50)
    expect(await getRanking(s.ctxCliente)).toMatchObject({ enabled: false, entries: [] })
  })

  test('módulo desligado recusa', async () => {
    const s = await cenaFidelidade({ modulo: false })
    expect((await domainError(getRanking(s.dono))).code).toBe('module_disabled')
  })

  test('ligado: só o primeiro nome, ordem por pontos, posição, sem anonimizados nem arquivados, só pontos ganhos', async () => {
    const s = await cenaFidelidade()
    await ligar(s)
    const ana = await makeCustomer(s.b.id, { name: 'Ana Souza Lima' })
    const bia = await makeCustomer(s.b.id, { name: 'Bia Costa' })
    const anon = await makeCustomer(s.b.id, { name: 'Cliente removido', archivedAt: AGORA, anonymizedAt: AGORA })
    const arq = await makeCustomer(s.b.id, { name: 'Davi Arquivado', archivedAt: AGORA })
    const zero = await makeCustomer(s.b.id, { name: 'Zero Pontos' })
    await earn(s, ana.id, 80)
    await earn(s, bia.id, 120)
    await earn(s, bia.id, -30)
    await earn(s, s.cliente.id, 10)
    await earn(s, anon.id, 999)
    await earn(s, arq.id, 999)
    await earn(s, zero.id, 40)
    await earn(s, zero.id, -40)
    await lancar(s.b.id, s.cliente.id, 5000, { kind: 'ADJUST' })
    await lancar(s.b.id, s.cliente.id, -50, { kind: 'REDEEM', createdAt: AGORA })
    const r = await getRanking(s.ctxCliente)
    expect(r.enabled).toBe(true)
    expect(r.month).toBe('2026-11')
    expect(r.entries.map((e) => [e.position, e.firstName, e.points])).toEqual([
      [1, 'Bia', 90],
      [2, 'Ana', 80],
      [3, 'Maria', 10],
    ])
    // Só a linha do próprio cliente leva `isYou`; as dos outros têm sempre as quatro chaves.
    for (const e of r.entries) expect(Object.keys(e).filter((k) => k !== 'isYou').sort()).toEqual(['avatarUrl', 'firstName', 'points', 'position'])
    expect(r.entries.filter((e) => e.isYou).map((e) => e.firstName)).toEqual(['Maria'])
    expect((await getRanking(s.dono)).entries.some((e) => 'isYou' in e)).toBe(false)
  })

  test('só os 10 primeiros', async () => {
    const s = await cenaFidelidade()
    await ligar(s)
    for (let i = 1; i <= 12; i++) await earn(s, (await makeCustomer(s.b.id, { name: `Cliente${i} Sobrenome` })).id, i)
    const r = await getRanking(s.dono)
    expect(r.entries).toHaveLength(10)
    expect(r.entries[0]).toMatchObject({ position: 1, points: 12 })
    expect(r.entries[9]).toMatchObject({ position: 10, points: 3 })
  })

  test('mês local de Manaus: 23:30 do último dia do mês anterior fica fora, a meia-noite local entra', async () => {
    const s = await cenaFidelidade()
    await ligar(s)
    const ana = await makeCustomer(s.b.id, { name: 'Ana' })
    const bia = await makeCustomer(s.b.id, { name: 'Bia' })
    await earn(s, ana.id, 70, new Date('2026-11-01T03:30:00Z'))
    await earn(s, bia.id, 20, new Date('2026-11-01T04:00:00Z'))
    await earn(s, bia.id, 5, new Date('2026-12-01T03:59:00Z'))
    const r = await getRanking(s.dono)
    expect(r.entries.map((e) => [e.firstName, e.points])).toEqual([['Bia', 25]])
  })

  test('a conta B não aparece no ranking da conta A', async () => {
    const s = await cenaFidelidade()
    await ligar(s)
    const b2 = await cenaFidelidade()
    await ligar(b2)
    await earn(b2, b2.cliente.id, 500)
    expect((await getRanking(s.dono)).entries).toEqual([])
  })
})
