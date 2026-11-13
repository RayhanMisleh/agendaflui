import { cloneElement, isValidElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cx } from './cx'

type ControlProps = { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' }

/** Liga rótulo, dica e erro ao campo por id e aria-describedby. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactElement<ControlProps> | ReactNode
  className?: string
}) {
  const uid = useId()
  const child = isValidElement<ControlProps>(children) ? children : null
  const id = child?.props.id ?? `${uid}-campo`
  const hintId = hint ? `${uid}-dica` : undefined
  const errorId = error ? `${uid}-erro` : undefined
  const describedBy =
    [child?.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('af-field', className)}>
      <label htmlFor={id} className="af-field__label">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="af-field__hint">
          {hint}
        </p>
      ) : null}
      {child
        ? cloneElement(child, {
            id,
            'aria-describedby': describedBy,
            ...(error ? { 'aria-invalid': true } : {}),
          })
        : children}
      {error ? (
        <p id={errorId} className="af-field__error">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}
