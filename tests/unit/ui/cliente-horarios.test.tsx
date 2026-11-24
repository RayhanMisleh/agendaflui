// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { HorarioLinha } from '@/app/app/[slug]/horarios/_lib/HorarioLinha'
import { HorariosVazios } from '@/app/app/[slug]/horarios/_lib/HorariosVazios'
import type { AppointmentView } from '@/server/domain/scheduling/appointments'

function horario(o: Partial<AppointmentView> = {}): AppointmentView {
  return {
    id: 'h1',
    status: 'CONFIRMED',
    source: 'APP',
    startsAt: new Date('2026-11-28T17:00:00Z'),
    endsAt: new Date('2026-11-28T18:00:00Z'),
    local: { date: '2026-11-28', start: '14:00', end: '15:00' },
    customer: { id: 'c1', name: 'Marina', phoneLabel: null },
    professional: { id: 'p1', name: 'Ana' },
    pet: { id: 'thor', name: 'Thor', typeLabel: 'Cão médio' },
    items: [{ serviceId: 's1', name: 'Banho', priceCents: 6500, durationMin: 60, variant: 'DOG_MEDIUM' }],
    totalCents: 6500,
    totalDurationMin: 60,
    customerNote: null,
    change: { allowed: true, until: null, untilLabel: null },
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

test('linha mostra pet, hora e situação; encaixe nunca aparece como palavra', () => {
  render(
    <ul>
      <HorarioLinha slug="a" a={{ ...horario(), isSqueezeIn: true, notes: 'encaixe interno' }} today="2026-11-25" />
    </ul>,
  )
  const link = screen.getByRole('link')
  expect(link).toHaveAttribute('href', '/a/horarios/h1')
  expect(link).toHaveTextContent('sáb., 28 de nov.')
  expect(screen.getByText('14:00')).toHaveClass('af-tabular')
  expect(link).toHaveTextContent('Thor · Banho')
  expect(link).toHaveTextContent('com Ana')
  expect(screen.getByText('Confirmado')).toBeInTheDocument()
  expect(document.body.textContent?.toLowerCase()).not.toContain('encaixe')
})

test('pendente mostra o selo de aguardando confirmação', () => {
  render(
    <ul>
      <HorarioLinha slug="a" a={horario({ status: 'PENDING' })} today="2026-11-25" />
    </ul>,
  )
  expect(screen.getByText('Aguardando confirmação')).toBeInTheDocument()
})

test('vazio dos próximos convida a agendar; o dos anteriores só explica', () => {
  const a = render(<HorariosVazios slug="a" anteriores={false} />)
  expect(screen.getByRole('heading', { name: 'Nenhum horário marcado' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Agendar' })).toHaveAttribute('href', '/a/agendar')
  a.unmount()
  render(<HorariosVazios slug="a" anteriores />)
  expect(screen.getByRole('heading', { name: 'Seus horários anteriores aparecem aqui.' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Agendar' })).toBeNull()
})
