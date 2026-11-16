import { TriangleAlert } from 'lucide-react'
import { cx } from './cx'

/**
 * Resumo de erro no alto do formulário: a mensagem geral e a lista dos campos com erro (com o nome do campo).
 * Anunciado por leitor de tela (`role="alert"`). Sem erro, não desenha nada.
 */
export function FormErrors({
  message,
  fields,
  labels = {},
  className,
}: {
  message: string | null
  fields: Record<string, string>
  /** Nome legível de cada campo, para a lista (`slug` → "Identificador"). */
  labels?: Record<string, string>
  className?: string
}) {
  const itens = Object.entries(fields)
  if (!message && itens.length === 0) return null
  return (
    <div role="alert" className={cx('af-formerrors', className)}>
      <TriangleAlert size={20} aria-hidden="true" className="af-formerrors__icon" />
      <div className="af-formerrors__body">
        {message ? <p className="af-formerrors__message">{message}</p> : null}
        {itens.length > 0 ? (
          <ul className="af-formerrors__list">
            {itens.map(([campo, texto]) => (
              <li key={campo}>
                <strong>{labels[campo] ?? campo}:</strong> {texto}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
