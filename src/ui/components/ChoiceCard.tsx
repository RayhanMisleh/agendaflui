import { useId, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cx } from './cx'

/**
 * Cartão de escolha (porte, serviço, forma de receber): um `<label>` com o `<input>` nativo (radio ou caixa) escondido só
 * para os olhos, então teclado e leitor de tela funcionam sem código extra. O visto entra animado; apertar afunda o cartão.
 * Desabilitado, mostra o motivo em texto.
 */
export function ChoiceCard(p: {
  type: 'radio' | 'checkbox'
  name: string
  value: string
  checked: boolean
  onChange: (value: string, checked: boolean) => void
  title: string
  detail?: ReactNode
  media?: ReactNode
  disabled?: boolean
  disabledReason?: string
  className?: string
}) {
  const reasonId = useId()
  const reason = p.disabled && p.disabledReason ? p.disabledReason : null
  return (
    <label className={cx('af-cl-choice', p.checked && 'is-checked', p.disabled && 'is-disabled', p.className)}>
      <input
        className="af-cl-choice__input"
        type={p.type}
        name={p.name}
        value={p.value}
        checked={p.checked}
        disabled={p.disabled}
        aria-describedby={reason ? reasonId : undefined}
        onChange={(e) => p.onChange(p.value, e.target.checked)}
      />
      {p.media ? (
        <span className="af-cl-choice__media" aria-hidden="true">
          {p.media}
        </span>
      ) : null}
      <span className="af-cl-choice__body">
        <span className="af-cl-choice__title">{p.title}</span>
        {p.detail ? <span className="af-cl-choice__detail">{p.detail}</span> : null}
        {reason ? (
          <span id={reasonId} className="af-cl-choice__reason">
            {reason}
          </span>
        ) : null}
      </span>
      <span className="af-cl-choice__check" aria-hidden="true">
        <Check size={16} strokeWidth={3} />
      </span>
    </label>
  )
}
