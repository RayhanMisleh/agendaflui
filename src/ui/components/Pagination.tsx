import Link from 'next/link'
import { ArrowLeftToLine, ArrowRight } from 'lucide-react'
import { cx } from './cx'

/** Endereço de uma página da lista: a busca e os filtros ficam, o cursor entra por último. Vazios somem. */
export function pageHref(basePath: string, params: Record<string, string | undefined>, cursor: string | null): string {
  const q = new URLSearchParams()
  for (const [chave, valor] of Object.entries(params)) {
    if (valor !== undefined && valor !== '') q.set(chave, valor)
  }
  if (cursor) q.set('cursor', cursor)
  const texto = q.toString()
  return texto ? `${basePath}?${texto}` : basePath
}

const LINK = 'af-button af-button--secondary af-button--md'

/**
 * Páginas por cursor, em botões secundários: "Próxima página" leva o cursor da página seguinte; "Voltar ao início" tira o
 * cursor e mantém a busca. O cursor só anda para frente; o botão voltar do navegador cuida do resto (a URL guarda o
 * estado). `summary` é a contagem em texto, quando a tela tem uma ("12 contas nesta página").
 */
export function Pagination({
  basePath,
  params,
  cursor,
  nextCursor,
  summary,
}: {
  basePath: string
  params: Record<string, string | undefined>
  cursor: string | null
  nextCursor: string | null
  summary?: string
}) {
  if (!cursor && !nextCursor) return null
  return (
    <nav aria-label="Páginas da lista" className="af-pager">
      {cursor ? (
        <Link href={pageHref(basePath, params, null)} className={LINK}>
          <span className="af-button__label">
            <span className="af-button__icon" aria-hidden="true">
              <ArrowLeftToLine size={18} />
            </span>
            Voltar ao início
          </span>
        </Link>
      ) : null}
      {summary ? <p className="af-pager__summary">{summary}</p> : null}
      {nextCursor ? (
        <Link href={pageHref(basePath, params, nextCursor)} className={cx(LINK, 'af-pager__next')} rel="next">
          <span className="af-button__label">
            Próxima página
            <span className="af-button__icon" aria-hidden="true">
              <ArrowRight size={18} />
            </span>
          </span>
        </Link>
      ) : null}
    </nav>
  )
}
