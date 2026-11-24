import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { AppointmentView } from '@/server/domain/scheduling/appointments'
import { AppointmentStatusBadge } from '@/ui/components'
import { relativeDayLabel } from '@/ui/format'

/**
 * Uma linha de Meus horários: dia, hora, pet, serviços, profissional e a situação em selo. Linha com divisória (não cartão),
 * alvo de toque inteiro. Nada de dado interno: a visão do cliente nem traz encaixe nem anotação da equipe.
 */
export function HorarioLinha({ slug, a, today }: { slug: string; a: AppointmentView; today: string }) {
  return (
    <li className="af-cl-appt">
      <Link href={`/${slug}/horarios/${a.id}`} className="af-cl-appt__link">
        <span className="af-cl-appt__when">
          <span className="af-cl-appt__day">{relativeDayLabel(a.local.date, today)}</span>
          <span className="af-cl-appt__time af-tabular">{a.local.start}</span>
        </span>
        <span className="af-cl-appt__body">
          <span className="af-cl-appt__what">
            {a.pet ? `${a.pet.name} · ` : ''}
            {a.items.map((i) => i.name).join(', ')}
          </span>
          <span className="af-cl-appt__who">com {a.professional.name}</span>
        </span>
        <AppointmentStatusBadge status={a.status} />
        <ChevronRight size={18} aria-hidden="true" className="af-cl-menu__chevron" />
      </Link>
    </li>
  )
}
