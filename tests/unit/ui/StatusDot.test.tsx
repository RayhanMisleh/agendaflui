// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { STATE_TEXT, StatusDot, businessStatusDot } from '@/ui/components'

test.each(['success', 'warning', 'danger', 'neutral'] as const)('tom %s: ponto decorativo e rótulo em texto', (tone) => {
  const { container } = render(<StatusDot tone={tone} label="Fila de avisos" />)
  expect(container.querySelector('.af-dot')).toHaveClass(`af-dot--${tone}`)
  expect(container.querySelector('.af-dot__mark')).toHaveAttribute('aria-hidden', 'true')
  expect(screen.getByText('Fila de avisos')).toBeInTheDocument()
})

test('o estado também sai em texto quando há detalhe', () => {
  render(<StatusDot tone="danger" label="API do aplicativo" detail={STATE_TEXT.danger} />)
  expect(screen.getByText('Com falha')).toBeInTheDocument()
})

test('situação da conta diz em texto, não só em cor', () => {
  const { rerender } = render(<StatusDot {...businessStatusDot('ACTIVE')} />)
  expect(screen.getByText('Ativa')).toBeInTheDocument()
  rerender(<StatusDot {...businessStatusDot('SUSPENDED')} />)
  expect(screen.getByText('Suspensa')).toBeInTheDocument()
  rerender(<StatusDot {...businessStatusDot('ARCHIVED')} />)
  expect(screen.getByText('Arquivada')).toBeInTheDocument()
})
