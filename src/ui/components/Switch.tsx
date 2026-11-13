'use client'
import { useId } from 'react'
import { cx } from './cx'

/** Chave física liga/desliga. Espaço e Enter alternam (botão nativo). */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  id,
  className,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  label: string
  disabled?: boolean
  id?: string
  className?: string
}) {
  const uid = useId()
  const btnId = id ?? `${uid}-chave`
  const labelId = `${uid}-rotulo`
  return (
    <div className={cx('af-switch', className)}>
      <button
        type="button"
        role="switch"
        id={btnId}
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        className="af-switch__btn"
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="af-switch__track" aria-hidden="true" data-state={checked ? 'on' : 'off'}>
          {/* Só o símbolo do estado atual aparece, no lado que a alavanca deixa livre. */}
          <span className="af-switch__mark af-switch__mark--off" data-mark="off" hidden={checked} />
          <span className="af-switch__mark af-switch__mark--on" data-mark="on" hidden={!checked} />
          <span className="af-switch__knob" />
        </span>
      </button>
      <label id={labelId} htmlFor={btnId} className="af-switch__label">
        {label}
      </label>
    </div>
  )
}
