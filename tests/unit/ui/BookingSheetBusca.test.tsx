// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ToastProvider } from '@/ui/components'
import type { AgendaPage } from '@/server/domain/scheduling/agenda-page'

const consultas = vi.hoisted(() => ({ buscarClientes: vi.fn(), cadastrarClienteRapido: vi.fn(), buscarHorarios: vi.fn(), buscarServicosDoPet: vi.fn() }))
vi.mock('@/app/app/painel/agenda/consultas', () => consultas)
vi.mock('@/app/app/painel/agenda/actions', () => ({ marcarHorario: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => '/painel/agenda', useSearchParams: () => new URLSearchParams() }))

import { BookingSheet } from '@/app/app/painel/agenda/BookingSheet'

const page = { professionals: [], services: [], scope: 'all', ownProfessionalId: null, filter: 'todos', date: '2026-11-17', today: '2026-11-17', view: 'dia' } as unknown as AgendaPage
const termos = { customerSingular: 'Cliente', professionalSingular: 'Profissional', professionalPlural: 'Profissionais' }

function abrir() {
  render(
    <ToastProvider>
      <BookingSheet open onClose={() => undefined} page={page} prefill={{ professionalId: '', date: '2026-11-17', time: '' }} termos={termos} podeCadastrar />
    </ToastProvider>,
  )
}

afterEach(() => vi.resetAllMocks())

test('busca mostra "Buscando…", limpa resultados antigos e o botão diz "Cadastrar cliente"', async () => {
  consultas.buscarClientes.mockResolvedValueOnce({ ok: true, clientes: [{ id: 'c1', name: 'Marina Souza', phoneLabel: null, pets: [] }] })
  abrir()
  const campo = screen.getByLabelText(/^Cliente/)
  await userEvent.type(campo, 'Mar')
  expect(await screen.findByRole('button', { name: /Marina Souza/ })).toBeInTheDocument()

  let resolver: (v: unknown) => void = () => undefined
  consultas.buscarClientes.mockReturnValueOnce(new Promise((r) => (resolver = r)))
  await userEvent.type(campo, 'x')
  expect(await screen.findByText('Buscando…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Marina Souza/ })).toBeNull()

  resolver({ ok: true, clientes: [] })
  const cadastrar = await screen.findByRole('button', { name: 'Cadastrar cliente' })
  expect(cadastrar).toBeInTheDocument()
  expect(screen.getByLabelText('Nome')).toHaveValue('Marx')
})

test('falha na busca mostra "Tentar de novo"', async () => {
  consultas.buscarClientes.mockRejectedValueOnce(new Error('rede'))
  abrir()
  await userEvent.type(screen.getByLabelText(/^Cliente/), 'Ana')
  expect(await screen.findByRole('alert')).toHaveTextContent('Não deu para buscar agora.')
  consultas.buscarClientes.mockResolvedValueOnce({ ok: true, clientes: [{ id: 'c2', name: 'Ana Lima', phoneLabel: null, pets: [] }] })
  await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByRole('button', { name: /Ana Lima/ })).toBeInTheDocument()
})
