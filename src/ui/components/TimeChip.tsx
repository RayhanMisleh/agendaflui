import { cx } from './cx'

/**
 * Chip de horário: livre, escolhido ou ocupado (desabilitado, riscado e dito em texto). Com `readOnly` é só o horário
 * em destaque (um `span`, sem botão), para mostrar a hora de um atendimento.
 */
export function TimeChip({
  time,
  state = 'free',
  onSelect,
  readOnly,
  className,
}: {
  time: string
  state?: 'free' | 'selected' | 'busy'
  onSelect?: (time: string) => void
  readOnly?: boolean
  className?: string
}) {
  if (readOnly) return <span className={cx('af-timechip af-timechip--static', className)}>{time}</span>
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
