import { CalendarPlus } from 'lucide-react'
import { EmptyIllustration, LinkButton } from '@/ui/components'

/** Meus horários sem nada: nos próximos convida a agendar; nos anteriores só diz onde eles vão aparecer. */
export function HorariosVazios({ slug, anteriores }: { slug: string; anteriores: boolean }) {
  return (
    <section className="af-cl-state af-cl-state--inline" aria-labelledby="horarios-vazio">
      <span className="af-cl-state__art">
        <EmptyIllustration name="horarios" size={96} />
      </span>
      <h2 id="horarios-vazio" className="af-cl-state__title">
        {anteriores ? 'Seus horários anteriores aparecem aqui.' : 'Nenhum horário marcado'}
      </h2>
      {anteriores ? null : (
        <LinkButton href={`/${slug}/agendar`} variant="primary" size="lg" icon={<CalendarPlus size={18} />}>
          Agendar
        </LinkButton>
      )}
    </section>
  )
}
