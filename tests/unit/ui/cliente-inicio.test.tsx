// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { Inicio } from '@/app/app/[slug]/_inicio/Inicio'
import { linkSeguro } from '@/app/app/[slug]/_inicio/Banners'
import type { AppointmentView } from '@/server/domain/scheduling/appointments'
import type { CustomerHome } from '@/server/domain/scheduling/customer-home'
import { ToastProvider } from '@/ui/components'
import { relativeDayLabel } from '@/ui/format'

vi.mock('@/app/app/[slug]/horarios/actions', () => ({ cancelarHorario: vi.fn() }))

const TELEFONE = { label: '(11) 99999-0000', href: 'tel:+5511999990000', whatsappHref: null }
const loja = { phone: TELEFONE, petNiche: true }

function horario(o: Partial<AppointmentView> = {}): AppointmentView {
  return {
    id: 'h1',
    status: 'CONFIRMED',
    source: 'APP',
    startsAt: new Date('2026-11-26T17:00:00Z'),
    endsAt: new Date('2026-11-26T18:00:00Z'),
    local: { date: '2026-11-26', start: '14:00', end: '15:00' },
    customer: { id: 'c1', name: 'Marina', phoneLabel: null },
    professional: { id: 'p1', name: 'Ana' },
    pet: { id: 'thor', name: 'Thor', typeLabel: 'Cão médio' },
    items: [{ serviceId: 's1', name: 'Banho', priceCents: 6500, durationMin: 60, variant: 'DOG_MEDIUM' }],
    totalCents: 6500,
    totalDurationMin: 60,
    customerNote: null,
    change: { allowed: true, until: new Date('2026-11-26T15:00:00Z'), untilLabel: '26/11/2026 12:00' },
    createdAt: new Date('2026-11-20T10:00:00Z'),
    createdLabel: '20/11/2026 07:00',
    canceledAt: null,
    canceledLabel: null,
    cancelReason: null,
    completedAt: null,
    completedLabel: null,
    ...o,
  }
}

const pet = (id: string, name: string) => ({ id, customerId: 'c1', name, species: 'DOG' as const, size: 'MEDIUM' as const, variant: 'DOG_MEDIUM' as const, typeLabel: 'Cão médio', rangeLabel: '10 a 25 kg', breed: null, birthMonth: null, ageLabel: null, coat: null, careNotes: null, photoUrl: null, archived: false, createdAt: new Date('2026-01-01T00:00:00Z') })

function home(o: Partial<CustomerHome> = {}): CustomerHome {
  return { firstName: 'Marina', pets: [pet('thor', 'Thor'), pet('mel', 'Mel')], next: horario(), rebook: null, banners: [], points: null, ...o }
}

const ver = (h: CustomerHome, l = loja) =>
  render(
    <ToastProvider>
      <Inicio slug="a" home={h} storefront={l} today="2026-11-25" />
    </ToastProvider>,
  )

test('herói com nome do pet, "Amanhã" e a hora', () => {
  ver(home())
  expect(screen.getByRole('heading', { name: 'Oi, Marina' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Thor' })).toBeInTheDocument()
  expect(screen.getByText('Amanhã')).toBeInTheDocument()
  expect(screen.getByText('14:00')).toHaveClass('af-tabular')
  expect(screen.getByText('Banho · com Ana')).toBeInTheDocument()
})

test('dentro do prazo mostra Remarcar e Cancelar horário; fora mostra o prazo e o telefone', () => {
  const a = ver(home())
  expect(screen.getByRole('link', { name: 'Remarcar' })).toHaveAttribute('href', '/a/horarios/h1/remarcar')
  expect(screen.getByRole('button', { name: 'Cancelar horário' })).toBeInTheDocument()
  a.unmount()
  ver(home({ next: horario({ change: { allowed: false, until: null, untilLabel: '26/11/2026 12:00' } }) }))
  expect(screen.queryByRole('link', { name: 'Remarcar' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Cancelar horário' })).toBeNull()
  const nota = screen.getByRole('note')
  expect(nota).toHaveTextContent('O prazo para mudar por aqui terminou em 26/11/2026 12:00.')
  expect(within(nota).getByRole('link', { name: '(11) 99999-0000' })).toHaveAttribute('href', 'tel:+5511999990000')
})

test('pendente mostra "Aguardando a loja confirmar"', () => {
  ver(home({ next: horario({ status: 'PENDING' }) }))
  expect(screen.getByText('Aguardando a loja confirmar')).toBeInTheDocument()
})

test('sem próximo: "Nenhum horário marcado" e Agendar', () => {
  ver(home({ next: null }))
  expect(screen.getByRole('heading', { name: 'Nenhum horário marcado' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Agendar' })).toHaveAttribute('href', '/a/agendar')
})

test('Agendar de novo leva a /a/agendar?pet=…&servicos=…', () => {
  ver(home({ rebook: { petId: 'thor', petName: 'Thor', serviceIds: ['s1'], serviceNames: ['Banho'], professionalId: null, professionalName: null, query: '?pet=thor&servicos=s1' } }))
  const link = screen.getByRole('link', { name: /Agendar de novo/ })
  expect(link).toHaveAttribute('href', '/a/agendar?pet=thor&servicos=s1')
  expect(link).toHaveTextContent('Banho para Thor com qualquer profissional')
})

test('points null esconde a linha de pontos; banners vazios não renderizam a faixa', () => {
  const a = ver(home())
  expect(screen.queryByRole('link', { name: /pontos?/ })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Novidades da loja' })).toBeNull()
  a.unmount()
  ver(home({ points: 120, banners: [{ id: 'b1', title: 'Dia do banho', imageUrl: '/img/b1.png', linkUrl: 'https://exemplo.com/oferta' }, { id: 'b2', title: 'Sem link', imageUrl: '/img/b2.png', linkUrl: 'javascript:alert(1)' }] }))
  expect(screen.getByRole('link', { name: /120 pontos/ })).toHaveAttribute('href', '/a/premios')
  expect(screen.getByRole('link', { name: 'Dia do banho' })).toHaveAttribute('href', 'https://exemplo.com/oferta')
  expect(screen.getByRole('img', { name: 'Sem link' }).closest('a')).toBeNull()
})

test('seus pets levam à ficha e o "+" ao quiz; loja sem pets não mostra a faixa', () => {
  const a = ver(home())
  expect(screen.getByRole('link', { name: /Thor/ })).toHaveAttribute('href', '/a/pets/thor')
  expect(screen.getByRole('link', { name: 'Adicionar pet' })).toHaveAttribute('href', '/a/boas-vindas?novo=1')
  a.unmount()
  ver(home(), { ...loja, petNiche: false })
  expect(screen.queryByRole('heading', { name: 'Seus pets' })).toBeNull()
})

test('as bolhas do herói são aria-hidden', () => {
  const { container } = ver(home())
  const bolhas = container.querySelector('.af-bubbles')
  expect(bolhas).toHaveAttribute('aria-hidden', 'true')
})

test('relativeDayLabel e links de banner seguros', () => {
  expect(relativeDayLabel('2026-11-25', '2026-11-25')).toBe('Hoje')
  expect(relativeDayLabel('2026-11-26', '2026-11-25')).toBe('Amanhã')
  expect(relativeDayLabel('2026-11-28', '2026-11-25')).toBe('sáb., 28 de nov.')
  expect(linkSeguro('a', '/a/premios')).toEqual({ href: '/a/premios', externo: false })
  expect(linkSeguro('a', '/b/premios')).toBeNull()
  expect(linkSeguro('a', '//evil.example')).toBeNull()
  expect(linkSeguro('a', null)).toBeNull()
})
