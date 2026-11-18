// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModulosForm, type UsoDosModulos } from '@/app/dev/(app)/contas/[id]/FormsConta'
import type { EstadoConta } from '@/app/dev/(app)/contas/[id]/forms'

const MSG = 'Vouchers exigem a Loja ligada, porque são vendidos como produto. Ligue a Loja ou desligue Vouchers.'
const ID = '5d2b8d7e-3f55-4a43-9c1e-0a3f6b1f2c11'
const PARADO: UsoDosModulos = { openOrders: 0, pendingRedemptions: 0, activeVoucherCodes: 0, mercadoPagoConfigured: true }
const erro: EstadoConta = { ok: false, message: 'Confira os campos marcados.', fields: { vouchers: MSG }, values: { vouchers: 'on', store: '' } }

test('o erro de vouchers sem loja fica ligado ao checkbox de vouchers por aria-describedby', async () => {
  const acao = vi.fn(async () => erro)
  render(<ModulosForm action={acao} valores={{ vouchers: 'on' }} businessId={ID} uso={PARADO} />)
  await userEvent.click(screen.getByRole('button', { name: 'Salvar módulos' }))
  const caixa = await screen.findByRole('checkbox', { name: /Vouchers/ })
  expect(caixa).toHaveAccessibleDescription(expect.stringContaining('Vouchers exigem a Loja ligada'))
  expect(caixa).toBeInvalid()
  // O que a pessoa marcou continua marcado.
  expect(caixa).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /^Loja: produtos/ })).not.toBeChecked()
})

test('sem erro o checkbox de vouchers não aponta para mensagem nenhuma', () => {
  render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={PARADO} />)
  const caixa = screen.getByRole('checkbox', { name: /Vouchers/ })
  expect(caixa).not.toHaveAccessibleDescription(expect.stringContaining('exigem a Loja'))
  expect(caixa).toBeValid()
})

test('ao lado de cada módulo diz o que está em andamento, com o singular e o plural certos', () => {
  const { rerender } = render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={{ ...PARADO, openOrders: 3, pendingRedemptions: 2, activeVoucherCodes: 14 }} />)
  expect(screen.getByRole('checkbox', { name: /^Loja: produtos/ })).toHaveAccessibleDescription('Em andamento: 3 pedidos pagos a entregar.')
  expect(screen.getByRole('checkbox', { name: /^Fidelidade/ })).toHaveAccessibleDescription('Em andamento: 2 resgates a entregar.')
  expect(screen.getByRole('checkbox', { name: /^Vouchers/ })).toHaveAccessibleDescription('Em andamento: 14 códigos de voucher ativos.')
  rerender(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={{ ...PARADO, openOrders: 1, pendingRedemptions: 1, activeVoucherCodes: 1 }} />)
  expect(screen.getByRole('checkbox', { name: /^Loja: produtos/ })).toHaveAccessibleDescription('Em andamento: 1 pedido pago a entregar.')
  expect(screen.getByRole('checkbox', { name: /^Fidelidade/ })).toHaveAccessibleDescription('Em andamento: 1 resgate a entregar.')
  expect(screen.getByRole('checkbox', { name: /^Vouchers/ })).toHaveAccessibleDescription('Em andamento: 1 código de voucher ativo.')
})

test('avisa que desligar esconde da conta e do app, mas guarda os dados', () => {
  render(<ModulosForm action={vi.fn()} valores={{}} businessId={ID} uso={PARADO} />)
  expect(screen.getByText(/esconde tudo isso da conta e do app, mas guarda os dados/)).toBeInTheDocument()
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
