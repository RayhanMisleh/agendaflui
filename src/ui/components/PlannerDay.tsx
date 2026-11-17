'use client'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { PageColumn } from '@/server/domain/scheduling/agenda-page'
import { AppointmentSlip } from './AppointmentSlip'
import { cx } from './cx'
import { PX_PER_MIN } from './planner/metrics'
import { TimeRail } from './TimeRail'

export type PlannerColumn = PageColumn

/** Linha do "agora": o minuto que o servidor informou, mais o tempo que a página já ficou aberta (sem fuso no navegador). */
function useNowMinute(initial: number | null): number | null {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (initial === null) return
    const timer = setInterval(() => setElapsed((e) => e + 1), 60_000)
    return () => clearInterval(timer)
  }, [initial])
  return initial === null ? null : initial + elapsed
}

/**
 * A grade do dia, como a agenda do site: horas na margem, uma coluna por profissional, fichas cheias, vagas livres
 * tracejadas, bloqueios hachurados e a linha do agora. No celular mostra um profissional por vez, com abas. Todo horário
 * chega pronto do servidor; aqui só se posiciona por minutos desde o começo da janela.
 */
export function PlannerDay({
  columns,
  startMin,
  endMin,
  hours,
  nowMin: nowFromServer,
  onOpenSlip,
  onBookGap,
  label,
}: {
  columns: PlannerColumn[]
  startMin: number
  endMin: number
  hours: { min: number; label: string }[]
  nowMin: number | null
  onOpenSlip: (id: string) => void
  onBookGap: (professionalId: string, startMin: number) => void
  label: string
}) {
  const [active, setActive] = useState(columns[0]?.id ?? '')
  const current = columns.some((c) => c.id === active) ? active : (columns[0]?.id ?? '')
  const nowMin = useNowMinute(nowFromServer)
  const height = (endMin - startMin) * PX_PER_MIN
  const gridStyle: CSSProperties & Record<`--${string}`, string> = { '--af-pxmin': String(PX_PER_MIN), '--af-cols': String(Math.max(1, columns.length)) }
  const showNow = nowMin !== null && nowMin >= startMin && nowMin <= endMin

  return (
    <div className="af-planner" role="region" aria-label={label} style={gridStyle}>
      {columns.length > 1 ? (
        <div role="tablist" aria-label="Profissionais" className="af-planner__tabs">
          {columns.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`planner-tab-${c.id}`}
              aria-selected={c.id === current}
              aria-controls={`planner-col-${c.id}`}
              tabIndex={c.id === current ? 0 : -1}
              className={cx('af-planner__tab', c.id === current && 'af-planner__tab--active')}
              onClick={() => setActive(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="af-planner__scroll">
        <div className="af-planner__grid">
          <div className="af-planner__railcol">
            <div className="af-planner__colhead" aria-hidden="true" />
            <TimeRail startMin={startMin} endMin={endMin} hours={hours} nowMin={nowMin} />
          </div>
          {columns.map((c) => (
            <div key={c.id} id={`planner-col-${c.id}`} data-col={c.id} data-active={c.id === current ? 'true' : 'false'} className={cx('af-planner__col', c.inactive && 'af-planner__col--inactive')}>
              <p className="af-planner__colhead">
                {c.name}
                {c.inactive ? <span className="af-planner__colnote"> (fora da agenda)</span> : null}
              </p>
              <div className="af-planner__body" style={{ height: `${height}px` }}>
                {c.gaps.map((g) => (
                  <button
                    key={`${g.startMin}-${g.endMin}`}
                    type="button"
                    className="af-planner__gap"
                    style={{ top: `${(g.startMin - startMin) * PX_PER_MIN}px`, height: `${(g.endMin - g.startMin) * PX_PER_MIN}px` }}
                    aria-label={`Marcar horário com ${c.name}, livre das ${g.startLabel} às ${g.endLabel}`}
                    onClick={() => onBookGap(c.id, g.startMin)}
                  >
                    <span className="af-planner__gaplabel">Livre · marcar</span>
                  </button>
                ))}
                {c.blocks.map((b) => (
                  <div key={b.id} className="af-planner__block" style={{ top: `${b.topMin * PX_PER_MIN}px`, height: `${b.heightMin * PX_PER_MIN}px` }}>
                    <span className="af-planner__blocklabel">{b.label}</span>
                    <span className="af-planner__blocktime">
                      {b.startLabel} às {b.endLabel}
                    </span>
                  </div>
                ))}
                {[...c.slips]
                  .sort((a, b) => a.box.topMin - b.box.topMin || a.box.lane - b.box.lane || a.id.localeCompare(b.id))
                  .map((s) => (
                    <AppointmentSlip key={s.id} slip={s} onOpen={onOpenSlip} />
                  ))}
                {showNow ? <span className="af-planner__now" aria-hidden="true" style={{ top: `${(nowMin - startMin) * PX_PER_MIN}px` }} /> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
