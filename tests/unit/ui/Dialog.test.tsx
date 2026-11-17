// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '@/ui/components'

test('Esc fecha e o título nomeia o diálogo', async () => {
  const onClose = vi.fn()
  render(
    <Dialog open onClose={onClose} title="Novo agendamento">
      conteúdo
    </Dialog>,
  )
  expect(screen.getByRole('dialog', { name: 'Novo agendamento' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})

test('fechado não aparece e aberto trava a rolagem da página', () => {
  const { rerender } = render(
    <Dialog open={false} onClose={() => {}} title="Novo agendamento">
      conteúdo
    </Dialog>,
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  rerender(
    <Dialog open onClose={() => {}} title="Novo agendamento">
      conteúdo
    </Dialog>,
  )
  expect(document.body.style.overflow).toBe('hidden')
  rerender(
    <Dialog open={false} onClose={() => {}} title="Novo agendamento">
      conteúdo
    </Dialog>,
  )
  expect(document.body.style.overflow).not.toBe('hidden')
})

test('clique no fundo fecha, clique no conteúdo não', async () => {
  const onClose = vi.fn()
  render(
    <Dialog open onClose={onClose} title="Novo agendamento">
      <button type="button">dentro</button>
    </Dialog>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'dentro' }))
  expect(onClose).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('dialog'))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('devolve o foco ao gatilho ao fechar', async () => {
  function Host({ open }: { open: boolean }) {
    return (
      <>
        <button type="button">Abrir</button>
        <Dialog open={open} onClose={() => {}} title="Novo agendamento">
          x
        </Dialog>
      </>
    )
  }
  const { rerender } = render(<Host open={false} />)
  const trigger = screen.getByRole('button', { name: 'Abrir' })
  trigger.focus()
  rerender(<Host open />)
  rerender(<Host open={false} />)
  expect(trigger).toHaveFocus()
})

test('Esc que um filho já tratou não fecha o diálogo', async () => {
  const onClose = vi.fn()
  render(
    <Dialog open onClose={onClose} title="Novo agendamento">
      <input
        aria-label="Busca"
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault()
        }}
      />
    </Dialog>,
  )
  screen.getByRole('textbox', { name: 'Busca' }).focus()
  await userEvent.keyboard('{Escape}')
  expect(onClose).not.toHaveBeenCalled()
  screen.getByRole('dialog').focus()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('o título é um h2 próprio, sem estar dentro de outro título', () => {
  render(
    <Dialog open onClose={() => {}} title="Novo agendamento">
      x
    </Dialog>,
  )
  const h = screen.getByRole('heading', { name: 'Novo agendamento' })
  expect(h.tagName).toBe('H2')
  expect(h.closest('h1, h2, h3, h4, h5, h6, [role="heading"]')).toBe(h)
})
