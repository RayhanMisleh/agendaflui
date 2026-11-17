import { PX_PER_MIN } from './planner/metrics'

/** A margem de horas da agenda: um rótulo por hora cheia, em algarismos de largura fixa. Só marca o tempo, não lê como lista. */
export function TimeRail({ startMin, endMin, hours, nowMin }: { startMin: number; endMin: number; hours: { min: number; label: string }[]; nowMin: number | null }) {
  return (
    <div className="af-planner__rail" aria-hidden="true" style={{ height: `${(endMin - startMin) * PX_PER_MIN}px` }}>
      {hours.map((h) => (
        <span key={h.min} className="af-planner__hour" style={{ top: `${(h.min - startMin) * PX_PER_MIN}px` }}>
          {h.label}
        </span>
      ))}
      {nowMin !== null && nowMin >= startMin && nowMin <= endMin ? <span className="af-planner__now-dot" style={{ top: `${(nowMin - startMin) * PX_PER_MIN}px` }} /> : null}
    </div>
  )
}
