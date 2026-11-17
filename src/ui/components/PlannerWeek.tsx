import Link from 'next/link'
import type { PageWeekDay } from '@/server/domain/scheduling/agenda-page'
import { formatLocalDate, shortDate, weekdayName } from '@/ui/format'
import { Meter } from './Meter'
import { cx } from './cx'
import { SITUACOES } from './AppointmentStatusBadge'

/** A semana em sete colunas compactas (uma pilha no celular): contagem, ocupação e os primeiros atendimentos. Tocar no dia abre o dia. */
export function PlannerWeek({ days, hrefFor, label }: { days: PageWeekDay[]; hrefFor: (date: string) => string; label: string }) {
  return (
    <ol className="af-week" aria-label={label}>
      {days.map((d) => {
        const dia = weekdayName(d.weekday)
        const contagem = d.count === 0 ? 'Nenhum atendimento' : d.count === 1 ? '1 atendimento' : `${d.count} atendimentos`
        return (
          <li key={d.date} className={cx('af-week__day', d.isToday && 'af-week__day--today', d.closed && 'af-week__day--closed')}>
            <Link href={hrefFor(d.date)} className="af-week__link" aria-label={`Abrir ${dia}, ${formatLocalDate(d.date)}: ${contagem}`}>
              <span className="af-week__weekday">{dia}</span>
              <span className="af-week__date">{shortDate(d.date)}</span>
            </Link>
            <p className="af-week__count">{d.closed ? 'Fechado' : contagem}</p>
            {d.occupancy !== null ? (
              <Meter value={d.occupancy} label={`Ocupação de ${dia}`} display={`${Math.round(d.occupancy * 100)}%`} />
            ) : d.closed ? null : (
              <p className="af-week__muted">Sem expediente</p>
            )}
            {d.items.length > 0 ? (
              <ul className="af-week__items">
                {d.items.map((i) => (
                  <li key={i.id} className={cx('af-week__item', i.status === 'PENDING' && 'af-week__item--attention')}>
                    <span className="af-week__itemtime">{i.startLabel}</span>
                    <span className="af-week__itemname">{i.customerName}</span>
                    {i.status === 'PENDING' ? <span className="af-sr"> ({SITUACOES.PENDING.texto})</span> : null}
                  </li>
                ))}
                {d.more > 0 ? <li className="af-week__more">+ {d.more} mais</li> : null}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
