// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { PageSlip } from '@/server/domain/scheduling/agenda-page'
import { AppointmentSlip } from '@/ui/components'

const base: PageSlip = {
  id: 'a1',
  professionalId: 'p1',
  status: 'CONFIRMED',
  customerName: 'Marina',
  petName: 'Thor',
  squeezeIn: false,
  services: 'Banho',
  startLabel: '14:00',
  endLabel: '15:00',
  box: { id: 'a1', topMin: 0, heightMin: 60, lane: 0, lanes: 1 },
  attention: false,
  draggable: false,
}

test('ficha com pet mostra o pet como nome e o cliente com os serviços', () => {
  render(<AppointmentSlip slip={base} onOpen={() => {}} />)
  const b = screen.getByRole('button')
  expect(b).toHaveAccessibleName('14:00, Thor, Banho, Confirmado')
  expect(screen.getByText('Marina · Banho')).toBeInTheDocument()
  expect(screen.queryByText('Encaixe')).not.toBeInTheDocument()
})

test('AppointmentSlip de encaixe mostra "Encaixe" e o aria-label termina com ", encaixe"', () => {
  render(<AppointmentSlip slip={{ ...base, squeezeIn: true }} onOpen={() => {}} />)
  const b = screen.getByRole('button')
  expect(b.getAttribute('aria-label')?.endsWith(', encaixe')).toBe(true)
  expect(b).toHaveClass('af-slip--squeeze')
  expect(screen.getByText('Encaixe')).toBeInTheDocument()
})

test('sem pet a ficha segue com o cliente', () => {
  render(<AppointmentSlip slip={{ ...base, petName: null }} onOpen={() => {}} />)
  expect(screen.getByRole('button')).toHaveAccessibleName('14:00, Marina, Banho, Confirmado')
})
