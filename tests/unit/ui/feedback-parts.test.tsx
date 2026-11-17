// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Avatar, EmptyState, Skeleton, Toast, ToastProvider, useToast } from '@/ui/components'

function Disparo() {
  const toast = useToast()
  return (
    <>
      <button type="button" onClick={() => toast({ tone: 'success', message: 'Banho agendado.' })}>
        um
      </button>
      <button type="button" onClick={() => toast({ tone: 'danger', message: 'Não foi possível salvar.' })}>
        dois
      </button>
    </>
  )
}

test('Toast diz o tom em texto para o leitor de tela e tem ponto decorativo', () => {
  const { container } = render(<Toast tone="danger" message="Não foi possível salvar." />)
  expect(screen.getByText('Erro:')).toHaveClass('af-sr')
  expect(screen.getByText('Não foi possível salvar.')).toBeInTheDocument()
  expect(container.querySelector('.af-toast__dot')).toHaveAttribute('aria-hidden', 'true')
  expect(container.firstElementChild).toHaveClass('af-toast--danger')
})

test('os avisos entram numa região viva só', async () => {
  const { container } = render(
    <ToastProvider>
      <Disparo />
    </ToastProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'um' }))
  await userEvent.click(screen.getByRole('button', { name: 'dois' }))
  expect(container.querySelectorAll('[aria-live]')).toHaveLength(1)
  expect(screen.getByText('Banho agendado.')).toBeInTheDocument()
  expect(screen.getByText('Não foi possível salvar.')).toBeInTheDocument()
  await act(async () => {})
})

test('EmptyState: bolhas decorativas, título h3, frase e ação', () => {
  const { container } = render(<EmptyState title="Nenhum cliente ainda" description="Cadastre o primeiro." action={<button type="button">Novo cliente</button>} />)
  expect(screen.getByRole('heading', { level: 3, name: 'Nenhum cliente ainda' })).toBeInTheDocument()
  expect(screen.getByText('Cadastre o primeiro.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Novo cliente' })).toBeInTheDocument()
  const arte = container.querySelector('.af-empty__art')
  expect(arte).toHaveAttribute('aria-hidden', 'true')
  expect(arte?.children).toHaveLength(3)
})

test('Avatar sem foto mostra as iniciais; com foto, a imagem', () => {
  const { rerender, container } = render(<Avatar name="Marina Lopes" />)
  expect(screen.getByRole('img', { name: 'Marina Lopes' })).toHaveTextContent('ML')
  rerender(<Avatar name="Marina Lopes" src="/foto.png" />)
  expect(container.querySelector('img')).toHaveAttribute('src', '/foto.png')
})

test('Skeleton anuncia que está carregando e o resto é decoração', () => {
  const { container } = render(<Skeleton lines={4} />)
  expect(screen.getByRole('status')).toHaveTextContent('Carregando…')
  expect(container.querySelectorAll('.af-skeleton__line')).toHaveLength(4)
})
