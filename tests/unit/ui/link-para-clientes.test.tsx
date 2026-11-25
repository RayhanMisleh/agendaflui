// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { LinkParaClientes } from '@/app/app/painel/_lib/LinkParaClientes'

const link = { url: 'https://app.exemplo.com/patas-e-cia', qrSvg: '<svg viewBox="0 0 1 1"></svg>' }

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
})

test('mostra o link, Copiar e o QR code recolhido', () => {
  render(<LinkParaClientes link={link} />)
  expect(screen.getByRole('textbox', { name: 'Link para clientes' })).toHaveValue(link.url)
  expect(screen.getByRole('button', { name: 'Copiar link para clientes' })).toBeInTheDocument()
  const detalhes = screen.getByText('Mostrar QR code').closest('details')
  expect(detalhes).not.toBeNull()
  expect(detalhes).not.toHaveAttribute('open')
})

test('sem navigator.share não há botão Compartilhar', () => {
  render(<LinkParaClientes link={link} />)
  expect(screen.queryByRole('button', { name: 'Compartilhar' })).toBeNull()
})

test('com navigator.share o botão Compartilhar entrega o link', async () => {
  const share = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  render(<LinkParaClientes link={link} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Compartilhar' }))
  await waitFor(() => expect(share).toHaveBeenCalledWith({ url: link.url }))
})
