import type { CSSProperties } from 'react'
import type { PageSlip } from '@/server/domain/scheduling/agenda-page'
import { SITUACOES } from './AppointmentStatusBadge'
import { cx } from './cx'
import { PX_PER_MIN } from './planner/metrics'

/**
 * A ficha de um atendimento na grade: botão cheio na cor da conta (caramelo quando pede atenção). A altura é proporcional
 * à duração; fichas que se sobrepõem dividem a largura. O nome acessível diz hora, cliente, serviços e situação, nunca só cor.
 */
export function AppointmentSlip({ slip, onOpen }: { slip: PageSlip; onOpen: (id: string) => void }) {
  const situacao = SITUACOES[slip.status].texto
  const { box } = slip
  const style: CSSProperties & Record<`--${string}`, string> = {
    top: `${box.topMin * PX_PER_MIN}px`,
    height: `${box.heightMin * PX_PER_MIN}px`,
    '--lane': String(box.lane),
    '--lanes': String(box.lanes),
  }
  return (
    <button
      type="button"
      data-slip={slip.id}
      data-status={slip.status}
      aria-label={`${slip.startLabel}, ${slip.customerName}, ${slip.services}, ${situacao}`}
      className={cx('af-slip', `af-slip--${slip.status.toLowerCase().replace('_', '-')}`, slip.attention && 'af-slip--attention')}
      style={style}
      onClick={() => onOpen(slip.id)}
    >
      <span className="af-slip__name">{slip.customerName}</span>
      <span className="af-slip__service">{slip.services}</span>
      <span className="af-slip__time">
        {slip.startLabel} às {slip.endLabel}
      </span>
      {slip.status === 'CONFIRMED' ? null : <span className="af-slip__status">{situacao}</span>}
    </button>
  )
}
