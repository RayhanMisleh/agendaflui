export const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
export const ALLOWED_HEADERS = 'authorization, content-type, x-app-key, x-business, idempotency-key'
export const EXPOSED_HEADERS = 'retry-after, x-request-id'
export const PREFLIGHT_MAX_AGE_SEC = 600

const MAX_ORIGIN_CHARS = 300
// esquema://host[:porta]; host é nome (com pontos e hífens) ou IPv6 entre colchetes. Sem caminho, usuário nem espaço.
const ORIGEM = /^https?:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i
const MIOLO_DO_CURINGA = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

/** O texto parece uma origem (`http(s)://host[:porta]`)? Não diz se ela é permitida. */
export function isSyntacticOrigin(origin: string): boolean {
  return origin.length <= MAX_ORIGIN_CHARS && ORIGEM.test(origin)
}

/**
 * A origem recebida casa com alguma das origens salvas na chave? Igualdade exata, ou o curinga
 * `http://*.localhost[:porta]`, que casa qualquer subdomínio de localhost naquela porta (e só nela).
 * Lista vazia não libera nada.
 */
export function originAllowed(origin: string, allowed: readonly string[]): boolean {
  if (!isSyntacticOrigin(origin)) return false
  const recebida = origin.toLowerCase()
  for (const salva of allowed) {
    if (salva === recebida) return true
    if (!salva.startsWith('http://*.')) continue
    const sufixo = salva.slice('http://*'.length) // `.localhost` ou `.localhost:5173`
    if (!recebida.startsWith('http://') || !recebida.endsWith(sufixo)) continue
    const miolo = recebida.slice('http://'.length, recebida.length - sufixo.length)
    if (MIOLO_DO_CURINGA.test(miolo)) return true
  }
  return false
}

/** Cabeçalhos de uma resposta real a uma origem já aprovada. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-expose-headers': EXPOSED_HEADERS,
    vary: 'Origin',
  }
}

/** Cabeçalhos da resposta ao pré-voo. */
export function preflightHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-allow-headers': ALLOWED_HEADERS,
    'access-control-max-age': String(PREFLIGHT_MAX_AGE_SEC),
    vary: 'Origin',
  }
}
