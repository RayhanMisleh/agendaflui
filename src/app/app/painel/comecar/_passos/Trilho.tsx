import { Check, Minus } from 'lucide-react'
import Link from 'next/link'
import type { OnboardingView } from '@/server/domain/onboarding/progress'

const ESTADO: Record<OnboardingView['steps'][number]['status'], string> = { done: ' (feito)', skipped: ' (pulado)', todo: '' }

/**
 * A trilha dos passos: cada um é um link para o seu endereço (funciona sem JavaScript e deixa voltar a qualquer passo).
 * O atual leva `aria-current="step"`; feito e pulado dizem isso em texto, não só em cor. Usa o desenho do `StepRail`.
 */
export function Trilho({ steps, atual }: { steps: OnboardingView['steps']; atual: string }) {
  return (
    <nav aria-label="Passos do começo" className="af-steprail af-onb__rail">
      <ol className="af-steprail__list">
        {steps.map((s, i) => (
          <li key={s.key} className="af-steprail__item">
            <Link
              href={`/painel/comecar?passo=${s.slug}`}
              className={`af-steprail__link${s.slug === atual ? ' af-steprail__link--current' : ''}${s.status === 'done' ? ' af-steprail__link--done' : ''}${s.status === 'skipped' ? ' af-onb__rail-skipped' : ''}`}
              aria-current={s.slug === atual ? 'step' : undefined}
            >
              <span className="af-steprail__dot" aria-hidden="true">
                {s.status === 'done' ? <Check size={16} /> : s.status === 'skipped' ? <Minus size={16} /> : i + 1}
              </span>
              <span className="af-steprail__label">{s.label}</span>
              <span className="af-sr">{ESTADO[s.status]}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
