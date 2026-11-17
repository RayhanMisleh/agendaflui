// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModulosForm } from '@/app/dev/(app)/contas/[id]/FormsConta'
import type { EstadoConta } from '@/app/dev/(app)/contas/[id]/forms'

const MSG = 'Vouchers exigem a Loja ligada, porque são vendidos como produto. Ligue a Loja ou desligue Vouchers.'
const erro: EstadoConta = { ok: false, message: 'Confira os campos marcados.', fields: { vouchers: MSG }, values: { vouchers: 'on', store: '' } }

test('o erro de vouchers sem loja fica ligado ao checkbox de vouchers por aria-describedby', async () => {
  const acao = vi.fn(async () => erro)
  render(<ModulosForm action={acao} valores={{ vouchers: 'on' }} />)
  await userEvent.click(screen.getByRole('button', { name: 'Salvar módulos' }))
  const caixa = await screen.findByRole('checkbox', { name: /Vouchers/ })
  expect(caixa).toHaveAccessibleDescription(expect.stringContaining('Vouchers exigem a Loja ligada'))
  expect(caixa).toBeInvalid()
  // O que a pessoa marcou continua marcado.
  expect(caixa).toBeChecked()
  expect(screen.getByRole('checkbox', { name: /^Loja: produtos/ })).not.toBeChecked()
})

test('sem erro o checkbox de vouchers não aponta para mensagem nenhuma', () => {
  render(<ModulosForm action={vi.fn()} valores={{}} />)
  expect(screen.getByRole('checkbox', { name: /Vouchers/ })).not.toHaveAttribute('aria-describedby')
})
