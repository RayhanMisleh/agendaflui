export const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
export const ALLOWED_HEADERS = 'authorization, content-type, x-business, idempotency-key'
export const EXPOSED_HEADERS = 'retry-after, x-request-id'
export const PREFLIGHT_MAX_AGE_SEC = 600

const MAX_ORIGIN_CHARS = 300
// esquema://host[:porta]; host é nome (com pontos e hífens) ou IPv6 entre colchetes. Sem caminho, usuário nem espaço.
const ORIGEM = /^https?:\/\/(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i
const LOCAL = /^https?:\/\/(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/

/**
 * Origens web do app próprio que podem chamar a API pelo navegador. `allowLocalhost` libera qualquer origem local
 * (`localhost`, `*.localhost`, `127.0.0.1` e `[::1]`, em qualquer porta) para desenvolver o app web.
 */
export type WebOrigins = { origins: readonly string[]; allowLocalhost: boolean }

/** O texto parece uma origem (`http(s)://host[:porta]`)? Não diz se ela é permitida. */
export function isSyntacticOrigin(origin: string): boolean {
  return origin.length <= MAX_ORIGIN_CHARS && ORIGEM.test(origin)
}

/** A origem é da própria máquina (localhost, `*.localhost`, 127.0.0.1 ou [::1])? */
export function isLocalOrigin(origin: string): boolean {
  return isSyntacticOrigin(origin) && LOCAL.test(origin.toLowerCase())
}

/**
 * Lê `APP_WEB_ORIGINS` (origens separadas por vírgula, ex.: `https://app.agendaflui.com.br`) e `NODE_ENV`. Localhost só é
 * liberado fora de produção. Não valida o formato: o `env.ts` recusa valor malformado na partida.
 */
export function webOriginsFromEnv(source: Record<string, string | undefined>): WebOrigins {
  const origins = (source['APP_WEB_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim().toLowerCase().replace(/\/$/, ''))
    .filter((o) => o !== '')
  return { origins: [...new Set(origins)], allowLocalhost: source['NODE_ENV'] !== 'production' }
}

/** As origens web do app, do ambiente do processo. */
export function appWebOrigins(): WebOrigins {
  return webOriginsFromEnv(process.env)
}

/** A origem recebida (do cabeçalho `Origin` ou de um endereço) é do app web? Igualdade exata, ou local fora de produção. */
export function originAllowed(origin: string, cfg: WebOrigins): boolean {
  if (!isSyntacticOrigin(origin)) return false
  const recebida = origin.toLowerCase()
  return cfg.origins.includes(recebida) || (cfg.allowLocalhost && isLocalOrigin(recebida))
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
