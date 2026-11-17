'use client'
import { Check, CircleAlert } from 'lucide-react'
import { cx } from './cx'

export type RailStep = { id: string; label: string }

/**
 * Trilho de etapas de um formulário longo, com círculos numerados como os "três passos" do site (os vistos em `brand`, o atual
 * em `accent`, os futuros vazios). Cada etapa é uma âncora para a sua seção (`#etapa-<id>`): sem JavaScript o
 * formulário é uma página só e o trilho rola até a seção; com JavaScript, `onSelect` troca a etapa visível. A etapa
 * atual leva `aria-current="step"`; etapa com erro e etapa já vista dizem isso em texto, não só em cor.
 */
export function StepRail({
  steps,
  current,
  onSelect,
  errorSteps = [],
  visitedUntil = current,
  className,
}: {
  steps: ReadonlyArray<RailStep>
  current: number
  onSelect: (index: number) => void
  /** Posições (a partir de 0) das etapas com erro. */
  errorSteps?: number[]
  /** Maior posição já visitada; as anteriores à atual aparecem como concluídas. */
  visitedUntil?: number
  className?: string
}) {
  return (
    <nav aria-label="Etapas da criação da conta" className={cx('af-steprail', className)}>
      <ol className="af-steprail__list">
        {steps.map((s, i) => {
          const erro = errorSteps.includes(i)
          const feita = !erro && i < current && i <= visitedUntil
          return (
            <li key={s.id} className="af-steprail__item">
              <a
                href={`#etapa-${s.id}`}
                className={cx('af-steprail__link', i === current && 'af-steprail__link--current', erro && 'af-steprail__link--error', feita && 'af-steprail__link--done')}
                aria-current={i === current ? 'step' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  onSelect(i)
                }}
              >
                <span className="af-steprail__dot" aria-hidden="true">
                  {erro ? <CircleAlert size={16} /> : feita ? <Check size={16} /> : i + 1}
                </span>
                <span className="af-steprail__label">{s.label}</span>
                {erro ? <span className="af-steprail__note"> (com erro)</span> : feita ? <span className="af-sr"> (vista)</span> : null}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
