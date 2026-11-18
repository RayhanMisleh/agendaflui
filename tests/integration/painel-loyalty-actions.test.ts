import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { createPrize } from '@/server/domain/loyalty/prizes'
import { redeemPrize } from '@/server/domain/loyalty/redemptions'
import { getLoyaltySettings, updateLoyaltySettings } from '@/server/domain/loyalty/settings'
import { resetDb } from '../setup/db'
import { cenaFidelidade, lancar, saldoNoBanco, type CenaFidelidade } from '../setup/loyalty'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})

import {
  ajustarPontos,
  arquivarPremio,
  cancelarResgate,
  criarPremio,
  entregarResgate,
  moverPremio,
  resgatarNoBalcao,
  salvarPremio,
  salvarRanking,
} from '@/app/painel/(app)/fidelidade/actions'
import FidelidadePage from '@/app/painel/(app)/fidelidade/page'
import NovoPremioPage from '@/app/painel/(app)/fidelidade/premios/novo/page'
import PremioPage from '@/app/painel/(app)/fidelidade/premios/[id]/page'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let s: CenaFidelidade
beforeEach(async () => {
  await resetDb()
  s = await cenaFidelidade()
  guards.requireTenant.mockResolvedValue(s.dono)
})
afterEach(() => guards.requireTenant.mockReset())

const PREMIO = { name: 'Corte grátis', description: '', costPoints: '100', stock: '' }
const premios = () => prisma.prize.findMany({ where: { businessId: s.b.id }, orderBy: { displayOrder: 'asc' } })
const novoPremio = (nome: string, custo = 100) => createPrize(s.dono, { name: nome, description: null, costPoints: custo, stock: null, active: true })

describe('prêmios', () => {
  test('criar grava (estoque vazio = sem limite) e leva à ficha do prêmio', async () => {
    await expect(criarPremio(ini, form({ ...PREMIO, active: 'on' }))).rejects.toThrow(/NEXT_REDIRECT \/fidelidade\/premios\//)
    expect((await premios())[0]).toMatchObject({ name: 'Corte grátis', costPoints: 100, stock: null, active: true })
  })

  test('custo 0 volta como erro no campo do custo e nada é gravado', async () => {
    const r = await criarPremio(ini, form({ ...PREMIO, costPoints: '0' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toEqual(['costPoints'])
    expect(r.values.costPoints).toBe('0')
    expect(await premios()).toHaveLength(0)
  })

  test('estoque digitado grava o número; texto no estoque erra no campo', async () => {
    const p = await novoPremio('A')
    expect((await salvarPremio(ini, form({ ...PREMIO, id: p.id, stock: '7', active: 'on' }))).ok).toBe(true)
    expect((await premios())[0]?.stock).toBe(7)
    expect(Object.keys((await salvarPremio(ini, form({ ...PREMIO, id: p.id, stock: 'muitos' }))).fields)).toEqual(['stock'])
  })

  test('profissional chamando direto: "sem permissão", e nada muda', async () => {
    guards.requireTenant.mockResolvedValue(s.profissional)
    const r = await criarPremio(ini, form(PREMIO))
    expect(r.message).toBe(NEGADO)
    const outro = await novoPremio('Já existe')
    expect((await arquivarPremio(ini, form({ id: outro.id }))).message).toBe(NEGADO)
    expect((await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '10', reason: 'Teste teste' }))).message).toBe(NEGADO)
    expect(await premios()).toHaveLength(1)
    expect((await premios())[0]?.archivedAt).toBeNull()
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
  })

  test('mover e arquivar', async () => {
    const a = await novoPremio('A')
    await novoPremio('B')
    await moverPremio(ini, form({ id: a.id, direction: 'down' }))
    expect((await premios()).map((p) => p.name)).toEqual(['B', 'A'])
    expect((await arquivarPremio(ini, form({ id: a.id }))).ok).toBe(true)
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: a.id } })).archivedAt).not.toBeNull()
  })

  test('módulo desligado: a ação recusa', async () => {
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: false } })
    const r = await criarPremio(ini, form(PREMIO))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Fidelidade/)
    expect(await premios()).toHaveLength(0)
  })
})

describe('resgates', () => {
  async function pendente() {
    const p = await novoPremio('Corte', 60)
    await lancar(s.b.id, s.cliente.id, 100)
    const { redemption } = await redeemPrize(s.dono, { prizeId: p.id, customerId: s.cliente.id })
    return redemption
  }

  test('cancelar pela tela devolve os pontos e guarda o motivo', async () => {
    const r = await pendente()
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(40)
    const out = await cancelarResgate(ini, form({ id: r.id, reason: 'Cliente desistiu' }))
    expect(out.ok).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(100)
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } })).cancelReason).toBe('Cliente desistiu')
  })

  test('entregar muda a situação; entregar de novo é recusado', async () => {
    const r = await pendente()
    expect((await entregarResgate(ini, form({ id: r.id }))).ok).toBe(true)
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('DELIVERED')
    expect((await entregarResgate(ini, form({ id: r.id }))).ok).toBe(false)
  })

  test('profissional não entrega nem cancela', async () => {
    const r = await pendente()
    guards.requireTenant.mockResolvedValue(s.profissional)
    expect((await entregarResgate(ini, form({ id: r.id }))).message).toBe(NEGADO)
    expect((await cancelarResgate(ini, form({ id: r.id, reason: '' }))).message).toBe(NEGADO)
    expect((await prisma.prizeRedemption.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('PENDING')
  })
})

describe('ficha do cliente: ajuste e resgate no balcão', () => {
  test('ajuste grava o motivo e o saldo muda', async () => {
    const r = await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '+25', reason: 'Brinde de aniversário' }))
    expect(r.ok).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(25)
    const linha = await prisma.loyaltyTransaction.findFirstOrThrow({ where: { customerId: s.cliente.id } })
    expect(linha).toMatchObject({ kind: 'ADJUST', points: 25, reason: 'Brinde de aniversário' })
    await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '-5', reason: 'Correção de lançamento' }))
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(20)
  })

  test('ajuste: valor vazio, com fração ou zero e motivo curto voltam como erro de campo', async () => {
    expect(Object.keys((await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '', reason: 'Motivo bom' }))).fields)).toEqual(['points'])
    expect(Object.keys((await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '1,5', reason: 'Motivo bom' }))).fields)).toEqual(['points'])
    expect(Object.keys((await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '0', reason: 'Motivo bom' }))).fields)).toEqual(['points'])
    expect(Object.keys((await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '5', reason: 'x' }))).fields)).toEqual(['reason'])
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
  })

  test('tirar mais do que o saldo é recusado', async () => {
    const r = await ajustarPontos(ini, form({ customerId: s.cliente.id, points: '-5', reason: 'Motivo bom' }))
    expect(r.ok).toBe(false)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(0)
  })

  test('resgatar no balcão: debita e, com "entregar agora", já entrega', async () => {
    const p = await novoPremio('Corte', 60)
    await lancar(s.b.id, s.cliente.id, 200)
    expect((await resgatarNoBalcao(ini, form({ customerId: s.cliente.id, prizeId: p.id, deliverNow: 'on' }))).ok).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(140)
    expect((await prisma.prizeRedemption.findFirstOrThrow({ where: { customerId: s.cliente.id } })).status).toBe('DELIVERED')
    await resgatarNoBalcao(ini, form({ customerId: s.cliente.id, prizeId: p.id }))
    expect((await prisma.prizeRedemption.findMany({ where: { status: 'PENDING' } })).length).toBe(1)
  })

  test('resgatar no balcão: reenviar com a mesma chave não debita de novo; chave nova é outro resgate', async () => {
    const p = await novoPremio('Corte', 60)
    await lancar(s.b.id, s.cliente.id, 200)
    const campos = { customerId: s.cliente.id, prizeId: p.id, requestId: 'folha-1', expectedCostPoints: '60' }
    expect((await resgatarNoBalcao(ini, form(campos))).ok).toBe(true)
    expect((await resgatarNoBalcao(ini, form(campos))).ok).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(140)
    expect(await prisma.prizeRedemption.count({ where: { customerId: s.cliente.id } })).toBe(1)
    expect((await resgatarNoBalcao(ini, form({ ...campos, requestId: 'folha-2' }))).ok).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(80)
    // A mesma chave com outro prêmio é recusada, sem debitar.
    const outro = await novoPremio('Barba', 30)
    const r = await resgatarNoBalcao(ini, form({ ...campos, prizeId: outro.id, expectedCostPoints: '30' }))
    expect(r.ok).toBe(false)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(80)
  })

  test('resgatar no balcão: o custo mostrado mudou, então é conflito e nada é debitado', async () => {
    const p = await novoPremio('Corte', 60)
    await lancar(s.b.id, s.cliente.id, 200)
    await prisma.prize.update({ where: { id: p.id }, data: { costPoints: 90 } })
    const r = await resgatarNoBalcao(ini, form({ customerId: s.cliente.id, prizeId: p.id, requestId: 'folha-9', expectedCostPoints: '60' }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/custo deste prêmio mudou/)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(200)
    expect(await prisma.prizeRedemption.count()).toBe(0)
  })

  test('resgatar no balcão: custo que não é número é recusado', async () => {
    const p = await novoPremio('Corte', 60)
    await lancar(s.b.id, s.cliente.id, 200)
    const r = await resgatarNoBalcao(ini, form({ customerId: s.cliente.id, prizeId: p.id, expectedCostPoints: 'abc' }))
    expect(r.ok).toBe(false)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(200)
  })

  test('resgatar no balcão sem saldo é recusado com a mensagem do domínio', async () => {
    const p = await novoPremio('Corte', 60)
    const r = await resgatarNoBalcao(ini, form({ customerId: s.cliente.id, prizeId: p.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Faltam 60/)
  })

  test('escolher um prêmio é obrigatório', async () => {
    expect(Object.keys((await resgatarNoBalcao(ini, form({ customerId: s.cliente.id, prizeId: '' }))).fields)).toEqual(['prizeId'])
  })
})

describe('ajustes da conta (ranking)', () => {
  test('liga o ranking com a versão lida', async () => {
    const { version } = await getLoyaltySettings(s.dono)
    const r = await salvarRanking(ini, form({ version: String(version), rankingEnabled: 'on' }))
    expect(r.ok).toBe(true)
    expect((await getLoyaltySettings(s.dono)).rankingEnabled).toBe(true)
  })

  test('versão antiga: conflito, nada muda e o digitado volta', async () => {
    const { version } = await getLoyaltySettings(s.dono)
    await updateLoyaltySettings(s.dono, version, { rankingEnabled: true })
    const r = await salvarRanking(ini, form({ version: String(version) }))
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/Alguém mudou/)
    expect(r.values.rankingEnabled).toBe('')
    expect(r.values.version).toBe(String(version))
    expect((await getLoyaltySettings(s.dono)).rankingEnabled).toBe(true)
  })

  test('gerente liga; profissional recebe "sem permissão"', async () => {
    const { version } = await getLoyaltySettings(s.dono)
    guards.requireTenant.mockResolvedValue(s.profissional)
    expect((await salvarRanking(ini, form({ version: String(version), rankingEnabled: 'on' }))).message).toBe(NEGADO)
    guards.requireTenant.mockResolvedValue(s.gerente)
    expect((await salvarRanking(ini, form({ version: String(version), rankingEnabled: 'on' }))).ok).toBe(true)
  })
})

describe('páginas', () => {
  const q = Promise.resolve({})
  test('com a Fidelidade desligada cada página responde 404', async () => {
    const p = await novoPremio('A')
    await prisma.businessModules.update({ where: { businessId: s.b.id }, data: { loyalty: false } })
    const nao = { digest: expect.stringContaining('404') }
    await expect(FidelidadePage({ searchParams: q })).rejects.toMatchObject(nao)
    await expect(NovoPremioPage()).rejects.toMatchObject(nao)
    await expect(PremioPage({ params: Promise.resolve({ id: p.id }), searchParams: q })).rejects.toMatchObject(nao)
  })
})

describe('revisão: estoque lido e ajuste repetido', () => {
  test('estoque que mudou no meio (resgate) vira conflito e não é desfeito', async () => {
    const p = await createPrize(s.dono, { name: 'Corte', description: null, costPoints: 10, stock: 5, active: true })
    await lancar(s.b.id, s.cliente.id, 100)
    await redeemPrize(s.dono, { prizeId: p.id, customerId: s.cliente.id })
    const r = await salvarPremio(ini, form({ id: p.id, name: 'Corte', description: '', costPoints: '10', stock: '5', expectedStock: '5', active: 'on' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe('O estoque mudou agora. Recarregue para ver.')
    expect((await prisma.prize.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(4)
    expect((await salvarPremio(ini, form({ id: p.id, name: 'Corte', description: '', costPoints: '10', stock: '4', expectedStock: '4', active: 'on' }))).ok).toBe(true)
    const sem = await createPrize(s.dono, { name: 'Sem limite', description: null, costPoints: 10, stock: null, active: true })
    expect((await salvarPremio(ini, form({ id: sem.id, name: 'Sem limite', description: '', costPoints: '10', stock: '', expectedStock: 'sem', active: 'on' }))).ok).toBe(true)
  })

  test('o mesmo requestId enviado duas vezes ajusta uma vez só e a segunda também responde sucesso', async () => {
    const REQ = '5b1d0a52-6a0e-4a8e-8f2b-9a7f3f0c1e11'
    const campos = { customerId: s.cliente.id, points: '30', reason: 'Brinde de teste', requestId: REQ }
    expect((await ajustarPontos(ini, form(campos))).ok).toBe(true)
    expect((await ajustarPontos(ini, form(campos))).ok).toBe(true)
    expect(await saldoNoBanco(s.b.id, s.cliente.id)).toBe(30)
  })
})
