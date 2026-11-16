// @vitest-environment jsdom
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ColorField } from '@/ui/components/ColorField'

function Teste({ inicial = '#0E4F5C', onChange = () => {} }: { inicial?: string; onChange?: (v: string) => void }) {
  const [valor, setValor] = useState(inicial)
  return (
    <ColorField
      label="Cor principal"
      name="primary"
      value={valor}
      onChange={(v) => {
        setValor(v)
        onChange(v)
      }}
    />
  )
}

test('tem rótulo e o campo de texto leva o nome do formulário', () => {
  render(<Teste />)
  const campo = screen.getByLabelText('Cor principal')
  expect(campo).toHaveAttribute('name', 'primary')
  expect(campo).toHaveValue('#0E4F5C')
})

test('aceita minúsculas, sem mensagem, e normaliza para maiúsculas ao sair do campo', async () => {
  const onChange = vi.fn()
  render(<Teste inicial="" onChange={onChange} />)
  const campo = screen.getByLabelText('Cor principal')
  await userEvent.type(campo, '#7a1f2b')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(campo).not.toHaveAttribute('aria-invalid', 'true')
  await userEvent.tab()
  expect(onChange).toHaveBeenLastCalledWith('#7A1F2B')
  expect(campo).toHaveValue('#7A1F2B')
})

test('recusa outro formato com mensagem ligada ao campo', async () => {
  render(<Teste inicial="" />)
  const campo = screen.getByLabelText('Cor principal')
  await userEvent.type(campo, '#12')
  await userEvent.tab()
  expect(campo).toHaveAttribute('aria-invalid', 'true')
  expect(campo).toHaveAccessibleDescription('Use uma cor no formato #RRGGBB, com 6 dígitos.')
})

test('o seletor de cor nativo e o texto andam juntos', async () => {
  const onChange = vi.fn()
  render(<Teste onChange={onChange} />)
  const seletor = screen.getByLabelText('Cor principal: escolher no seletor')
  expect(seletor).toHaveAttribute('type', 'color')
  expect(seletor).toHaveValue('#0e4f5c')
  // jsdom não abre o seletor: dispara a mudança como o navegador faria.
  const { fireEvent } = await import('@testing-library/react')
  fireEvent.change(seletor, { target: { value: '#112233' } })
  expect(onChange).toHaveBeenLastCalledWith('#112233')
  expect(screen.getByLabelText('Cor principal')).toHaveValue('#112233')
})

test('mostra o erro vindo do servidor e o aviso de ajuste', () => {
  render(<ColorField label="Cor de destaque" value="#E0A030" onChange={() => {}} error="Use uma cor válida." warning="A cor foi escurecida." />)
  expect(screen.getByLabelText('Cor de destaque')).toHaveAccessibleDescription(/Use uma cor válida/)
  expect(screen.getByText('A cor foi escurecida.')).toBeInTheDocument()
})
