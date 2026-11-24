import { ArrowRight, Check, Minus, PartyPopper } from 'lucide-react'
import Link from 'next/link'
import type { OnboardingView } from '@/server/domain/onboarding/progress'
import { Card, LinkButton, Meter } from '@/ui/components'
import { DispensarComeco } from './DispensarComeco'

const UM_DIA = 24 * 60 * 60 * 1000

type Estado = { ok: boolean; message: string | null; fields: Record<string, string> }

/** A lista cabe no Início enquanto falta algo e não foi dispensada; recém-concluída, vira o aviso "Tudo pronto" por um dia. */
export function mostraChecklist(view: OnboardingView | null, agora: Date): view is OnboardingView {
  if (view === null || view.dismissed) return false
  if (!view.completed) return true
  return view.completedAt !== null && agora.getTime() - view.completedAt.getTime() < UM_DIA
}

/**
 * "O que falta" no Início do dono: a barra "4 de 7", os passos que ainda faltam (os pulados dizem "Pulado") com link para cada
 * um, "Continuar" no primeiro e "Dispensar". Concluído, mostra "Tudo pronto" no lugar da lista.
 */
export function ChecklistComeco({ view, dismissAction }: { view: OnboardingView; dismissAction(prev: Estado, form: FormData): Promise<Estado> }) {
  if (view.completed) {
    return (
      <Card as="section" variant="tint" aria-labelledby="comeco-pronto" className="af-onb-check af-onb-check--done">
        <span className="af-onb-check__party" aria-hidden="true">
          <PartyPopper size={22} />
        </span>
        <div className="af-onb-check__body">
          <h2 id="comeco-pronto" className="af-onb-check__title">
            Tudo pronto
          </h2>
          <p className="af-onb-check__text">Sua loja já pode receber clientes.</p>
        </div>
      </Card>
    )
  }
  const faltam = view.steps.filter((s) => s.status !== 'done')
  const primeiro = view.steps.find((s) => s.key === view.current) ?? faltam[0]
  return (
    <Card as="section" aria-labelledby="comeco-titulo" className="af-onb-check">
      <div className="af-onb-check__body">
        <h2 id="comeco-titulo" className="af-onb-check__title">
          Falta pouco para abrir sua agenda
        </h2>
        <Meter label="Progresso do começo" value={view.total === 0 ? 0 : view.done / view.total} display={`${view.done} de ${view.total}`} className="af-onb__meter" />
        <ul className="af-onb-check__list">
          {faltam.map((s, i) => (
            <li key={s.key} className="af-onb-check__item af-enter" style={{ '--i': i } as React.CSSProperties}>
              <Link className="af-onb-check__link af-row-hit" href={`/painel/comecar?passo=${s.slug}`}>
                <span className="af-onb-check__dot" aria-hidden="true">
                  {s.status === 'skipped' ? <Minus size={14} /> : <Check size={14} />}
                </span>
                <span>{s.label}</span>
                {s.status === 'skipped' ? <span className="af-onb-check__tag">Pulado</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="af-onb-check__actions">
        {primeiro ? (
          <LinkButton href={`/painel/comecar?passo=${primeiro.slug}`} variant="primary" icon={<ArrowRight size={18} />}>
            Continuar
          </LinkButton>
        ) : null}
        <DispensarComeco action={dismissAction} />
      </div>
    </Card>
  )
}
