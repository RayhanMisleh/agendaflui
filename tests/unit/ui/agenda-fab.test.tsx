// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { AgendaFab } from '@/app/app/painel/agenda/AgendaFab'

test('com as duas ações, o toque abre o menu e cada opção chama a sua ação e fecha o menu', () => {
  const marcar = vi.fn()
  const bloquear = vi.fn()
  render(<AgendaFab onMarcar={marcar} onBloquear={bloquear} />)
  const botao = screen.getByRole('button', { name: 'Novo horário' })
  expect(botao).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('menu')).toBeNull()

  fireEvent.click(botao)
  expect(botao).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('menuitem', { name: 'Bloquear horário' }))
  expect(bloquear).toHaveBeenCalledTimes(1)
  expect(marcar).not.toHaveBeenCalled()
  expect(screen.queryByRole('menu')).toBeNull()

  fireEvent.click(botao)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Marcar horário' }))
  expect(marcar).toHaveBeenCalledTimes(1)
})

test('sem permissão de bloquear, o toque marca direto e não há menu', () => {
  const marcar = vi.fn()
  render(<AgendaFab onMarcar={marcar} />)
  fireEvent.click(screen.getByRole('button', { name: 'Marcar horário' }))
  expect(marcar).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
})

test('Escape e toque fora fecham o menu', () => {
  render(
    <div>
      <button type="button">fora</button>
      <AgendaFab onMarcar={() => undefined} onBloquear={() => undefined} />
    </div>,
  )
  const botao = screen.getByRole('button', { name: 'Novo horário' })
  fireEvent.click(botao)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(botao).toHaveFocus()

  fireEvent.click(botao)
  expect(screen.getByRole('menu')).toBeInTheDocument()
  fireEvent.pointerDown(screen.getByRole('button', { name: 'fora' }))
  expect(screen.queryByRole('menu')).toBeNull()
})
