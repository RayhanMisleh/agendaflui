// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '@/ui/components'

test.each(['confirmed', 'pending', 'done', 'canceled', 'no-show', 'neutral'] as const)(
  'selo %s tem ponto decorativo e o texto',
  (tone) => {
    const { container } = render(<StatusBadge tone={tone}>Situação</StatusBadge>)
    const selo = screen.getByText('Situação').closest('.af-badge')
    expect(selo).toHaveClass(`af-badge--${tone}`)
    const ponto = container.querySelector('.af-badge__dot')
    expect(ponto).toHaveAttribute('aria-hidden', 'true')
  },
)
