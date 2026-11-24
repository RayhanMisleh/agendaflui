import type { CSSProperties, KeyboardEventHandler, PointerEventHandler } from 'react'
import type { PageSlip } from '@/server/domain/scheduling/agenda-page'
import { SITUACOES } from './AppointmentStatusBadge'
import { cx } from './cx'
import { PX_PER_MIN } from './planner/metrics'

/**
 * A ficha de um atendimento na grade: botão cheio na cor da conta (caramelo quando pede atenção). A altura é proporcional
 * à duração; fichas que se sobrepõem dividem a largura. O conteúdo se adapta à altura (consulta de contêiner no CSS): curta mostra
 * pet e hora numa linha, média acrescenta cliente e serviço, alta mostra tudo, sem nunca sobrepor texto. O nome acessível diz hora, cliente, serviços e situação, nunca só cor.
 */
export type SlipDrag = {
  draggable: boolean
  lifted: boolean
  onPointerDown: PointerEventHandler<HTMLElement>
  onKeyDown: KeyboardEventHandler<HTMLElement>
  onBlur: () => void
  consumeClick: () => boolean
}

export function AppointmentSlip({ slip, onOpen, drag }: { slip: PageSlip; onOpen: (id: string) => void; drag?: SlipDrag }) {
  const situacao = SITUACOES[slip.status].texto
  const { box } = slip
  const principal = slip.petName ?? slip.customerName
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
      aria-label={`${slip.startLabel}, ${principal}, ${slip.services}, ${situacao}${slip.squeezeIn ? ', encaixe' : ''}`}
      className={cx('af-slip', `af-slip--${slip.status.toLowerCase().replace('_', '-')}`, slip.attention && 'af-slip--attention', slip.squeezeIn && 'af-slip--squeeze', drag?.draggable && 'af-slip--movable', drag?.lifted && 'af-slip--lifted')}
      style={style}
      onClick={() => {
        if (drag?.consumeClick()) return
        onOpen(slip.id)
      }}
      {...(drag?.draggable ? { onPointerDown: drag.onPointerDown, onKeyDown: drag.onKeyDown, onBlur: drag.onBlur } : {})}
    >
      <span className="af-slip__box">
        <span className="af-slip__name">{principal}</span>
        <span className="af-slip__time">
          {slip.startLabel}
          <span className="af-slip__end"> às {slip.endLabel}</span>
        </span>
        <span className="af-slip__service">{slip.petName ? `${slip.customerName} · ${slip.services}` : slip.services}</span>
        {slip.status === 'CONFIRMED' ? null : <span className="af-slip__status">{situacao}</span>}
        {slip.squeezeIn ? <span className="af-slip__tag">Encaixe</span> : null}
      </span>
    </button>
  )
}
