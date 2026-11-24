/**
 * "Volta ao ponto": o caminho para onde a pessoa segue depois de entrar. Só vale dentro da própria loja (`/<slug>` ou
 * `/<slug>/…`), sem esquema, barra dupla, barra invertida nem `..`. Qualquer outra coisa é descartada (`null`).
 */
const MAX = 300
const CAMINHO = /^[a-z0-9\-/]*$/
const CONSULTA = /^[A-Za-z0-9=&%,._-]*$/

export function safeReturnPath(slug: string, raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX) return null
  const corte = raw.indexOf('?')
  const caminho = corte === -1 ? raw : raw.slice(0, corte)
  const consulta = corte === -1 ? null : raw.slice(corte + 1)
  if (caminho !== `/${slug}` && !caminho.startsWith(`/${slug}/`)) return null
  if (!CAMINHO.test(caminho) || caminho.includes('//')) return null
  if (consulta !== null && !CONSULTA.test(consulta)) return null
  return raw
}
