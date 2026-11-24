import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, makeWorkingHours } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }), usePathname: () => '/painel', useSearchParams: () => new URLSearchParams() }
})
// A moldura lê sessão e marca; aqui só interessa o conteúdo da página.
vi.mock('@/app/app/painel/PainelFrame', () => ({ PainelFrame: ({ children }: { children: ReactNode }) => children }))

import InicioPage from '@/app/app/painel/page'
import ClientesPage from '@/app/app/painel/clientes/page'
import ClientePage from '@/app/app/painel/clientes/[id]/page'

beforeEach(resetDb)
afterEach(() => guards.requireTenant.mockReset())

const MANAUS = 'America/Manaus'
/** Terça-feira 17/11/2026, 08:00 em Manaus (UTC-4). */
const AGORA = new Date('2026-11-17T12:00:00Z')
const html = async (pagina: Promise<unknown>) => renderToStaticMarkup(await (pagina as Promise<Parameters<typeof renderToStaticMarkup>[0]>))

async function montar() {
  const b = await makeBusiness({ timezone: MANAUS })
  const banho = await makeService(b.id, { name: 'Banho', durationMin: 60, priceCents: 8000 })
  const ana = await makeProfessional(b.id, { name: 'Ana', displayOrder: 1, serviceIds: [banho.id] })
  await makeWorkingHours(b.id, ana.id, 'TUESDAY', [{ startMin: 540, endMin: 1080 }])
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  guards.requireTenant.mockResolvedValue(dono)
  const cliente = await makeCustomer(b.id, { name: 'Marina Souza' })
  return { b, banho, ana, dono, cliente }
}

describe('estados vazios que levam à ação', () => {
  test('aba Arquivados vazia mostra "Nenhum cliente arquivado" e "Ver ativos"', async () => {
    await montar()
    const saida = await html(ClientesPage({ searchParams: Promise.resolve({ situacao: 'arquivados' }) }))
    expect(saida).toContain('Nenhum cliente arquivado')
    expect(saida).toContain('Ver ativos')
    expect(saida).toContain('href="/painel/clientes"')
  })

  test('ficha sem atendimentos mostra "Marcar horário" para a agenda', async () => {
    const s = await montar()
    const saida = await html(ClientePage({ params: Promise.resolve({ id: s.cliente.id }), searchParams: Promise.resolve({}) }))
    expect(saida).toContain('Marcar horário')
    expect(saida).toContain('href="/painel/agenda?acao=marcar"')
  })

  test('Início com atendimento hoje liga o nome à agenda com ag=', async () => {
    const s = await montar()
    const ag = await makeAppointment(s.b.id, { customerId: s.cliente.id, professionalId: s.ana.id, serviceId: s.banho.id, startsAt: new Date('2026-11-17T14:00:00Z') })
    const saida = await html(InicioPage())
    expect(saida).toContain(`/painel/agenda?data=2026-11-17&amp;ag=${ag.id}`)
  })
})
