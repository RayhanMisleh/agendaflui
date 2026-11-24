// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { ModulosForm, type UsoDosModulos } from '@/app/dev/(app)/contas/[id]/FormsConta'

const ID = '5d2b8d7e-3f55-4a43-9c1e-0a3f6b1f2c11'
const PARADO: UsoDosModulos = { openOrders: 0, pendingRedemptions: 0, mercadoPagoConfigured: true }
test('ao lado de cada módulo diz o que está em andamento, com o singular e o plural certos', () => {
  const { rerender } = render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={{ ...PARADO, openOrders: 3, pendingRedemptions: 2 }} />)
  expect(screen.getByRole('checkbox', { name: /^Loja: produtos/ })).toHaveAccessibleDescription('Em andamento: 3 pedidos pagos a entregar.')
  expect(screen.getByRole('checkbox', { name: /^Fidelidade/ })).toHaveAccessibleDescription('Em andamento: 2 resgates a entregar.')
  rerender(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={{ ...PARADO, openOrders: 1, pendingRedemptions: 1 }} />)
  expect(screen.getByRole('checkbox', { name: /^Loja: produtos/ })).toHaveAccessibleDescription('Em andamento: 1 pedido pago a entregar.')
  expect(screen.getByRole('checkbox', { name: /^Fidelidade/ })).toHaveAccessibleDescription('Em andamento: 1 resgate a entregar.')
})

test('avisa que desligar esconde da conta e dos clientes, mas guarda os dados', () => {
  render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={PARADO} />)
  expect(screen.getByText(/esconde tudo isso da conta e dos clientes, mas guarda os dados/)).toBeInTheDocument()
})

describe('aviso de Loja sem Mercado Pago', () => {
  test('Loja ligada sem Mercado Pago mostra o aviso com o link da aba Integrações', () => {
    render(<ModulosForm action={vi.fn()} valores={{ store: 'on' }} businessId={ID} uso={{ ...PARADO, mercadoPagoConfigured: false }} />)
    expect(screen.getByRole('link', { name: /aba Integrações/ })).toHaveAttribute('href', `/contas/${ID}/integracoes`)
  })

  test('com o Mercado Pago configurado não avisa', () => {
    render(<ModulosForm action={vi.fn()} valores={{ store: 'on' }} businessId={ID} uso={PARADO} />)
    expect(screen.queryByRole('link', { name: /Integrações/ })).toBeNull()
  })

  test('com a Loja desligada não avisa', () => {
    render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={{ ...PARADO, mercadoPagoConfigured: false }} />)
    expect(screen.queryByRole('link', { name: /Integrações/ })).toBeNull()
  })
})

test('oferece só Fidelidade, Banners e Loja', () => {
  render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={PARADO} />)
  expect(screen.getAllByRole('checkbox').map((c) => c.getAttribute('name'))).toEqual(['loyalty', 'banners', 'store'])
})
