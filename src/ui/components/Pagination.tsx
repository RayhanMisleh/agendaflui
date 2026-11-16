import Link from 'next/link'
import { ArrowLeftToLine, ArrowRight } from 'lucide-react'

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

/**
 * Páginas por cursor: "Próxima página" leva o cursor da página seguinte; "Voltar ao início" tira o cursor e mantém a
 * busca. O cursor só anda para frente; o botão voltar do navegador cuida do resto (a URL guarda o estado).
 */
export function Pagination({
  basePath,
  params,
  cursor,
  nextCursor,
}: {
  basePath: string
  params: Record<string, string | undefined>
  cursor: string | null
  nextCursor: string | null
}) {
  if (!cursor && !nextCursor) return null
  return (
    <nav aria-label="Páginas da lista" className="af-pager">
      {cursor ? (
        <Link href={pageHref(basePath, params, null)} className="af-pager__link">
          <ArrowLeftToLine size={18} aria-hidden="true" />
          Voltar ao início
        </Link>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Link href={pageHref(basePath, params, nextCursor)} className="af-pager__link af-pager__link--next" rel="next">
          Próxima página
          <ArrowRight size={18} aria-hidden="true" />
        </Link>
      ) : null}
    </nav>
  )
}
