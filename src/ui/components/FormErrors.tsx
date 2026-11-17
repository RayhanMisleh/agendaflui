import { TriangleAlert } from 'lucide-react'
import { cx } from './cx'

/**
 * Resumo de erro no alto do formulário: cartão com a mensagem geral e a lista dos campos com erro (com o nome do campo).
 * Anunciado por leitor de tela (`role="alert"`). Sem erro, não desenha nada. Com `anchors` (nome do campo → id do campo),
 * o nome vira um link que leva até ele.
 */
export function FormErrors({
  message,
  fields,
  labels = {},
  anchors = {},
  className,
}: {
  message: string | null
  fields: Record<string, string>
  /** Nome legível de cada campo, para a lista (`slug` → "Identificador"). */
  labels?: Record<string, string>
  /** Id do elemento de cada campo, para o link da lista (`slug` → "campo-slug"). */
  anchors?: Record<string, string>
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
            {itens.map(([campo, texto]) => {
              const nome = labels[campo] ?? campo
              const alvo = anchors[campo]
              return (
                <li key={campo}>
                  <strong>{alvo ? <a href={`#${alvo}`}>{nome}</a> : nome}:</strong> {texto}
                </li>
              )
            })}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
