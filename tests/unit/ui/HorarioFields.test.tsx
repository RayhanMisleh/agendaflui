// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

const consultas = vi.hoisted(() => ({ buscarHorarios: vi.fn() }))
vi.mock('@/app/app/painel/agenda/consultas', () => consultas)

import { HorarioFields } from '@/app/app/painel/agenda/HorarioFields'

const HORARIOS = [{ iso: '2026-11-17T12:00:00.000Z', label: '08:00' }]

function Caixa({ servicos = ['s1'] }: { servicos?: string[] }) {
  const [date, setDate] = useState('2026-11-17')
  const [time, setTime] = useState('')
  const [chosen, setChosen] = useState('')
  return (
    <HorarioFields
      serviceIds={servicos}
      professionalId="p1"
      date={date}
      onDate={setDate}
      time={time}
      onTime={setTime}
      chosen={chosen}
      onChosen={setChosen}
      prefillTime=""
      conflict={undefined}
      errors={{}}
      idPrefix="t"
    />
  )
}

afterEach(() => consultas.buscarHorarios.mockReset())

test('trocar o dia some com os horários antigos e mostra "Buscando horários…"', async () => {
  consultas.buscarHorarios.mockResolvedValueOnce({ ok: true, horarios: HORARIOS })
  render(<Caixa />)
  expect(await screen.findByRole('button', { name: /08:00/ })).toBeInTheDocument()

  let resolver: (v: unknown) => void = () => undefined
  consultas.buscarHorarios.mockReturnValueOnce(new Promise((r) => (resolver = r)))
  const dia = screen.getByLabelText('Dia')
  await userEvent.clear(dia)
  await userEvent.type(dia, '2026-11-18')
  expect(await screen.findByText('Buscando horários…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /08:00/ })).toBeNull()

  resolver({ ok: true, horarios: [{ iso: '2026-11-18T13:00:00.000Z', label: '09:00' }] })
  expect(await screen.findByRole('button', { name: /09:00/ })).toBeInTheDocument()
  expect(screen.queryByText('Buscando horários…')).toBeNull()
})

test('falha mostra "Tentar de novo" e tentar busca de novo', async () => {
  consultas.buscarHorarios.mockRejectedValueOnce(new Error('rede'))
  render(<Caixa />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não deu para buscar os horários.')
  consultas.buscarHorarios.mockResolvedValueOnce({ ok: true, horarios: HORARIOS })
  await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByRole('button', { name: /08:00/ })).toBeInTheDocument()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(consultas.buscarHorarios).toHaveBeenCalledTimes(2)
})
