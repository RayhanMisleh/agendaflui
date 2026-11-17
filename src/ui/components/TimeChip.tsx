import { cx } from './cx'

/** Chip de horário: livre, escolhido ou ocupado (desabilitado, riscado e dito em texto). */
export function TimeChip({
  time,
  state = 'free',
  onSelect,
  className,
}: {
  time: string
  state?: 'free' | 'selected' | 'busy'
  onSelect?: (time: string) => void
  className?: string
}) {
  const ocupado = state === 'busy'
  return (
    <button
      type="button"
      disabled={ocupado}
      aria-pressed={ocupado ? undefined : state === 'selected'}
      aria-label={ocupado ? `${time}, ocupado` : undefined}
      className={cx('af-timechip', `af-timechip--${state}`, className)}
      onClick={() => onSelect?.(time)}
    >
      {time}
    </button>
  )
}
