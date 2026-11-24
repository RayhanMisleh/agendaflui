// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { SubmitButton } from '@/ui/components'

const estado = vi.hoisted(() => ({ pending: false }))
vi.mock('react-dom', async (original) => ({ ...(await original<typeof import('react-dom')>()), useFormStatus: () => ({ pending: estado.pending }) }))

afterEach(() => {
  estado.pending = false
  vi.useRealTimers()
})

test('formulário em andamento: botão desabilitado, ocupado e com "Aguarde…"', () => {
  estado.pending = true
  render(
    <form>
      <SubmitButton>Salvar</SubmitButton>
    </form>,
  )
  const botao = screen.getByRole('button')
  expect(botao).toBeDisabled()
  expect(botao).toHaveAttribute('aria-busy', 'true')
  expect(botao).toHaveTextContent('Aguarde…')
})

test('sem envio em andamento o botão fica habilitado e é do tipo submit', () => {
  render(
    <form>
      <SubmitButton>Salvar</SubmitButton>
    </form>,
  )
  const botao = screen.getByRole('button', { name: 'Salvar' })
  expect(botao).toBeEnabled()
  expect(botao).toHaveAttribute('type', 'submit')
  expect(botao).not.toHaveAttribute('aria-busy')
})

test('envio nativo (POST): só o botão que enviou espera, depois do corpo ser montado', () => {
  vi.useFakeTimers()
  render(
    <form method="post" action="/x" onSubmit={(e) => e.preventDefault()}>
      <SubmitButton name="intent" value="a">
        Enviar
      </SubmitButton>
      <SubmitButton name="intent" value="remove">
        Remover
      </SubmitButton>
    </form>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Remover' }))
  // Antes do adiamento o botão ainda não está desabilitado: o valor dele entra no corpo.
  expect(screen.getByRole('button', { name: 'Remover' })).toBeEnabled()
  act(() => {
    vi.advanceTimersByTime(1)
  })
  expect(screen.getByRole('button', { name: /Remover/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  // Passado o limite, a espera termina sozinha.
  act(() => {
    vi.advanceTimersByTime(10_000)
  })
  expect(screen.getByRole('button', { name: /Remover/ })).toBeEnabled()
})
