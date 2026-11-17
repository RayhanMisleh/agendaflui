// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sheet } from '@/ui/components'

function Host({ onClose = () => {} }: { onClose?: () => void }) {
  return (
    <>
      <button type="button">Fora</button>
      <Sheet open onClose={onClose} title="Novo horário" footer={<button type="button">Salvar</button>}>
        <input aria-label="Nome" />
        <button type="button">Meio</button>
      </Sheet>
    </>
  )
}

test('abre como diálogo nomeado pelo título, com a classe da folha', () => {
  render(<Host />)
  const d = screen.getByRole('dialog', { name: 'Novo horário' })
  expect(d).toHaveClass('af-sheet')
})

test('Esc fecha', async () => {
  const onClose = vi.fn()
  render(<Host onClose={onClose} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('o foco fica preso: Tab no último volta ao primeiro, Shift+Tab no primeiro vai ao último', async () => {
  render(<Host />)
  const dentro = [screen.getByRole('button', { name: 'Fechar' }), screen.getByRole('textbox', { name: 'Nome' }), screen.getByRole('button', { name: 'Meio' }), screen.getByRole('button', { name: 'Salvar' })]
  dentro[3]!.focus()
  await userEvent.tab()
  expect(dentro[0]).toHaveFocus()
  await userEvent.tab({ shift: true })
  expect(dentro[3]).toHaveFocus()
})

test('o foco não escapa para a página nem com Tab repetido', async () => {
  render(<Host />)
  const fora = screen.getByRole('button', { name: 'Fora' })
  const dialogo = screen.getByRole('dialog')
  for (let i = 0; i < 9; i++) {
    await userEvent.tab()
    expect(fora).not.toHaveFocus()
    expect(dialogo.contains(document.activeElement)).toBe(true)
  }
})

test('devolve o foco ao botão que abriu', () => {
  function Abre({ open }: { open: boolean }) {
    return (
      <>
        <button type="button">Abrir</button>
        <Sheet open={open} onClose={() => {}} title="Folha">
          x
        </Sheet>
      </>
    )
  }
  const { rerender } = render(<Abre open={false} />)
  const gatilho = screen.getByRole('button', { name: 'Abrir' })
  gatilho.focus()
  rerender(<Abre open />)
  rerender(<Abre open={false} />)
  expect(gatilho).toHaveFocus()
})

test('no computador a folha vira painel lateral e no celular sobe da base', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync(`${process.cwd()}/src/ui/styles/surfaces.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  // Celular: a regra da base é a do Dialog (folha que sobe); só acima de 40 rem a folha vira painel à direita.
  expect(css).toMatch(/@media \(min-width: 40\.0625rem\) \{\s*\.af-sheet \{[^}]*margin: 0 0 0 auto/)
  expect(css).toMatch(/\.af-sheet \.af-dialog__sheet \{[^}]*height: 100dvh/)
  expect(css).not.toMatch(/\.af-sheet\s*\{[^}]*margin: 0 0 0 auto[^}]*\}\s*@media \(max-width/)
})
