import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { redirect } from 'next/navigation'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { addMinutes } from '@/server/time'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, memberOf } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)

import { GET } from '@/app/app/painel/relatorios/exportar/route'
import { periodoDaUrl } from '@/app/app/painel/relatorios/periodo'

const MANAUS = 'America/Manaus'
const AGORA = new Date('2026-11-17T15:00:00Z')

/** Instante de uma hora local de Manaus (UTC-4) em 2026-11-<dia>. */
const mn = (dia: number, h: number, m = 0): Date => new Date(Date.UTC(2026, 10, dia, h + 4, m))

function pedido(consulta: string): Request {
  return new Request(`http://app.localhost:3000/relatorios/exportar${consulta}`)
}

async function montar() {
  const b = await makeBusiness({ timezone: MANAUS })
  const banho = await makeService(b.id, { name: 'Banho', priceCents: 8000 })
  const tosa = await makeService(b.id, { name: 'Tosa', priceCents: 5000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id, tosa.id] })
  const caio = await makeProfessional(b.id, { name: 'Caio', serviceIds: [banho.id, tosa.id] })
  const cliente = await makeCustomer(b.id, { name: 'Marina Souza' })
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  const feito = (quem: typeof ana, servico: typeof banho, dia: number) =>
    makeAppointment(b.id, { customerId: cliente.id, professionalId: quem.id, serviceId: servico.id, startsAt: addMinutes(mn(dia, 10), 0), status: 'COMPLETED' })
  return { b, banho, tosa, ana, caio, cliente, dono, feito }
}
type Cena = Awaited<ReturnType<typeof montar>>

beforeEach(async () => {
  await resetDb()
})
afterEach(() => guards.requireTenant.mockReset())

const linhas = (corpo: string): string[] => corpo.split('\r\n').filter((l) => l !== '')

describe('exportar CSV: cabeçalhos e corpo', () => {
  let s: Cena
  beforeEach(async () => {
    s = await montar()
    guards.requireTenant.mockResolvedValue(s.dono)
    await s.feito(s.ana, s.banho, 10)
  })

  test('tipo com charset, anexo com nome seguro pelo período, sem cache e sem farejar tipo', async () => {
    const r = await GET(pedido('?de=2026-11-01&ate=2026-11-17'))
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="relatorio-2026-11-01-a-2026-11-17.csv"')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('o corpo começa com BOM e o cabeçalho, e traz uma linha por atendimento', async () => {
    const r = await GET(pedido('?de=2026-11-01&ate=2026-11-17'))
    const bytes = new Uint8Array(await r.clone().arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const corpo = await r.text()
    expect(corpo.startsWith('Início;Término;Cliente;Profissional;Serviços;Situação;Valor;Comissão')).toBe(true)
    const [, primeira, ...resto] = linhas(corpo)
    expect(resto).toHaveLength(0)
    expect(primeira).toContain('Marina Souza')
    expect(primeira).toContain('Ana')
    expect(primeira).toContain('80,00')
  })

  test('o filtro de serviço entra no arquivo', async () => {
    await s.feito(s.ana, s.tosa, 11)
    const todos = linhas(await (await GET(pedido('?de=2026-11-01&ate=2026-11-17'))).text())
    expect(todos).toHaveLength(3)
    const soTosa = linhas(await (await GET(pedido(`?de=2026-11-01&ate=2026-11-17&servico=${s.tosa.id}`))).text())
    expect(soTosa).toHaveLength(2)
    expect(soTosa[1]).toContain('Tosa')
  })

  test('o filtro de profissional entra no arquivo para o dono', async () => {
    await s.feito(s.caio, s.banho, 12)
    const soCaio = linhas(await (await GET(pedido(`?de=2026-11-01&ate=2026-11-17&profissional=${s.caio.id}`))).text())
    expect(soCaio).toHaveLength(2)
    expect(soCaio[1]).toContain('Caio')
  })

  test('sem datas, vale o mês até hoje no fuso da conta (e o nome do arquivo diz qual)', async () => {
    const r = await GET(pedido(''))
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="relatorio-2026-11-01-a-2026-11-17.csv"')
  })

  test('texto que a planilha executaria como fórmula sai com apóstrofo', async () => {
    await prisma.customer.update({ where: { id: s.cliente.id }, data: { name: '=SOMA(A1)' } })
    const corpo = await (await GET(pedido('?de=2026-11-01&ate=2026-11-17'))).text()
    expect(corpo).toContain("'=SOMA(A1)")
  })
})

describe('exportar CSV: sessão, permissão e período antes de abrir o fluxo', () => {
  test('sem sessão redireciona para a entrada e não lê nada', async () => {
    const leitura = vi.spyOn(prisma.appointment, 'findMany')
    guards.requireTenant.mockImplementation(() => redirect('/entrar'))
    await expect(GET(pedido('?de=2026-11-01&ate=2026-11-17'))).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
    expect(leitura).not.toHaveBeenCalled()
    leitura.mockRestore()
  })

  test('período de 367 dias volta 422 com a mensagem, sem corpo de CSV', async () => {
    const s = await montar()
    guards.requireTenant.mockResolvedValue(s.dono)
    const r = await GET(pedido('?de=2025-11-17&ate=2026-11-18'))
    expect(r.status).toBe(422)
    expect(r.headers.get('content-type')).toContain('text/plain')
    expect(r.headers.get('content-disposition')).toBeNull()
    expect(r.headers.get('cache-control')).toBe('no-store')
    const texto = await r.text()
    expect(texto).toContain('366')
    expect(texto).not.toContain('Início;')
  })

  test('data final antes da inicial volta 422', async () => {
    const s = await montar()
    guards.requireTenant.mockResolvedValue(s.dono)
    const r = await GET(pedido('?de=2026-11-17&ate=2026-11-01'))
    expect(r.status).toBe(422)
  })

  test('quem não pode ver relatórios recebe 403 sem corpo de CSV', async () => {
    const s = await montar()
    // Profissional sem ficha ligada ao acesso: o domínio recusa.
    const sem = await ctxWithRole(s.b, 'PROFESSIONAL', { now: AGORA })
    guards.requireTenant.mockResolvedValue(sem)
    const r = await GET(pedido('?de=2026-11-01&ate=2026-11-17'))
    expect(r.status).toBe(403)
    expect(r.headers.get('content-disposition')).toBeNull()
    expect(await r.text()).not.toContain('Início;')
  })
})

describe('exportar CSV: o profissional baixa só as próprias linhas', () => {
  test('?profissional=<colega> é ignorado e o arquivo traz só os atendimentos dele', async () => {
    const s = await montar()
    const ctx: TenantContext = await ctxWithRole(s.b, 'PROFESSIONAL', { now: AGORA })
    await prisma.professional.update({ where: { id: s.ana.id }, data: { membershipId: memberOf(ctx).membershipId } })
    guards.requireTenant.mockResolvedValue(ctx)
    await s.feito(s.ana, s.banho, 10)
    await s.feito(s.caio, s.banho, 11)
    const r = await GET(pedido(`?de=2026-11-01&ate=2026-11-17&profissional=${s.caio.id}`))
    expect(r.status).toBe(200)
    const l = linhas(await r.text())
    expect(l).toHaveLength(2)
    expect(l[1]).toContain('Ana')
    expect(l.join('\n')).not.toContain('Caio')
  })
})

describe('periodoDaUrl', () => {
  const HOJE = '2026-11-17'
  test('atalhos no calendário da conta', () => {
    expect(periodoDaUrl({ atalho: 'hoje' }, HOJE)).toMatchObject({ from: '2026-11-17', to: '2026-11-17', atalho: 'hoje' })
    expect(periodoDaUrl({ atalho: '7dias' }, HOJE)).toMatchObject({ from: '2026-11-11', to: '2026-11-17', atalho: '7dias' })
    expect(periodoDaUrl({ atalho: 'mes' }, HOJE)).toMatchObject({ from: '2026-11-01', to: '2026-11-17', atalho: 'mes' })
    expect(periodoDaUrl({ atalho: 'mes-passado' }, HOJE)).toMatchObject({ from: '2026-10-01', to: '2026-10-31', atalho: 'mes-passado' })
  })

  test('mês passado atravessa a virada do ano e o fevereiro bissexto', () => {
    expect(periodoDaUrl({ atalho: 'mes-passado' }, '2027-01-05')).toMatchObject({ from: '2026-12-01', to: '2026-12-31' })
    expect(periodoDaUrl({ atalho: 'mes-passado' }, '2028-03-10')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' })
  })

  test('sem nada, o mês até hoje; intervalo livre vence o atalho; lixo na URL cai no padrão', () => {
    expect(periodoDaUrl({}, HOJE)).toMatchObject({ from: '2026-11-01', to: '2026-11-17', atalho: 'mes' })
    expect(periodoDaUrl({ atalho: 'hoje', de: '2026-10-05', ate: '2026-10-09' }, HOJE)).toMatchObject({ from: '2026-10-05', to: '2026-10-09', atalho: null })
    expect(periodoDaUrl({ atalho: 'semana-que-vem', de: 'ontem', ate: '' }, HOJE)).toMatchObject({ from: '2026-11-01', to: '2026-11-17', atalho: 'mes' })
  })

  test('só uma ponta preenchida usa a outra como o mesmo dia', () => {
    expect(periodoDaUrl({ de: '2026-11-03' }, HOJE)).toMatchObject({ from: '2026-11-03', to: '2026-11-03', atalho: null })
  })
})
