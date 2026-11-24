// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach } from 'vitest'
import { ShareButton } from '@/ui/components'

const URL_LOJA = 'https://app.exemplo.test/focinho'

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  vi.restoreAllMocks()
})

test('sem navigator.share copia e mostra "Link copiado."', async () => {
  const gravar = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: gravar }, configurable: true })
  render(<ShareButton url={URL_LOJA} title="Focinho" />)
  await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))
  expect(gravar).toHaveBeenCalledWith(URL_LOJA)
  expect(await screen.findByText('Link copiado.')).toBeInTheDocument()
})

test('com navigator.share abre a folha do aparelho e não copia', async () => {
  const share = vi.fn(async () => undefined)
  const gravar = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: gravar }, configurable: true })
  render(<ShareButton url={URL_LOJA} title="Focinho" text="Marque seu horário" />)
  await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))
  expect(share).toHaveBeenCalledWith({ url: URL_LOJA, title: 'Focinho', text: 'Marque seu horário' })
  expect(gravar).not.toHaveBeenCalled()
})

test('cancelamento do compartilhamento não mostra erro nem copia', async () => {
  const share = vi.fn(async () => {
    throw new DOMException('Cancelado', 'AbortError')
  })
  const gravar = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: gravar }, configurable: true })
  render(<ShareButton url={URL_LOJA} />)
  await userEvent.click(screen.getByRole('button', { name: 'Compartilhar' }))
  expect(gravar).not.toHaveBeenCalled()
  expect(screen.queryByText('Link copiado.')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('')
})
