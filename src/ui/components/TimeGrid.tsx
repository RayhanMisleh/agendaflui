import { cx } from './cx'

export type TimeGridTime = { iso: string; label: string }
export type TimeGridGroup = { label: 'Manhã' | 'Tarde' | 'Noite'; times: TimeGridTime[] }

/** Agrupa os horários do dia pela hora local do rótulo (`09:00`, `14:30 (2ª vez)`): antes das 12, antes das 18 e o resto. */
export function groupTimes(times: TimeGridTime[]): TimeGridGroup[] {
  const grupos: TimeGridGroup[] = [
    { label: 'Manhã', times: [] },
    { label: 'Tarde', times: [] },
    { label: 'Noite', times: [] },
  ]
  for (const t of times) {
    const hora = Number.parseInt(t.label.slice(0, 2), 10)
    const g = hora < 12 ? grupos[0] : hora < 18 ? grupos[1] : grupos[2]
    g?.times.push(t)
  }
  return grupos.filter((g) => g.times.length > 0)
}

/** Horários livres do dia em chips de 44 px, por período. Escolher devolve o instante exato (`iso`). */
export function TimeGrid(p: { groups: TimeGridGroup[]; value: string | null; onChange: (iso: string) => void }) {
  return (
    <div className="af-cl-times">
      {p.groups.map((g) => (
        <section key={g.label} className="af-cl-times__group" aria-label={g.label}>
          <h3 className="af-cl-times__label">{g.label}</h3>
          <div className="af-cl-times__row" role="group" aria-label={`Horários da ${g.label.toLowerCase()}`}>
            {g.times.map((t) => (
              <button
                key={t.iso}
                type="button"
                aria-pressed={t.iso === p.value}
                className={cx('af-cl-time', t.iso === p.value && 'is-selected')}
                onClick={() => p.onChange(t.iso)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
