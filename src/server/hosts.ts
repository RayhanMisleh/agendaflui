export type Area = 'dev' | 'app'
export type HostConfig = { dev: string; app: string; legacyPainel: string | null }
export type RouteDecision =
  | { action: 'rewrite'; to: string }
  | { action: 'pass' }
  | { action: 'not_found' }
  | { action: 'redirect'; path: string }

/** Padrões dos dois hosts em desenvolvimento: a única definição (env, proxy e dev.ts usam esta). */
export const DEFAULT_HOSTS = {
  dev: 'dev.localhost:3000',
  app: 'app.localhost:3000',
}

/** Lê DEV_HOST, APP_HOST e LEGACY_PAINEL_HOST (vazio ou ausente vale o padrão; o legado vale `null`). Não valida nada além disso. */
export function hostConfigFromEnv(source: Record<string, string | undefined>): HostConfig {
  return {
    dev: source['DEV_HOST'] || DEFAULT_HOSTS.dev,
    app: source['APP_HOST'] || DEFAULT_HOSTS.app,
    legacyPainel: source['LEGACY_PAINEL_HOST'] || null,
  }
}

const AREAS: readonly Area[] = ['dev', 'app']

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

export function resolveArea(host: string | null | undefined, cfg: HostConfig): Area | null {
  if (!host) return null
  const alvo = normalizeHost(host)
  if (alvo === '') return null
  return AREAS.find((area) => normalizeHost(cfg[area]) === alvo) ?? null
}

function isLegacyPainel(host: string | null | undefined, cfg: HostConfig): boolean {
  if (!host || cfg.legacyPainel === null) return false
  const alvo = normalizeHost(host)
  return alvo !== '' && alvo === normalizeHost(cfg.legacyPainel)
}

function isPassthrough(pathname: string): boolean {
  return (
    pathname === '/favicon.ico' ||
    pathname.startsWith('/_next/') ||
    // Arquivos de public/: servidos como estão, em qualquer host conhecido (sem reescrever para a pasta da área).
    pathname.startsWith('/brand/') ||
    pathname.startsWith('/arquivos/')
  )
}

/** Primeiro segmento decodificado e em minúsculas; null se a codificação for inválida. */
function firstSegment(pathname: string): string | null {
  const segmento = pathname.split('/')[1] ?? ''
  try {
    return decodeURIComponent(segmento).toLowerCase()
  } catch {
    return null
  }
}

/**
 * Caminho no host novo para um endereço do antigo `painel.<domínio>`; `null` quando não existe mais (vira 404).
 * O painel da loja agora mora em `/painel/**`; a entrada e os arquivos mantêm o caminho.
 */
export function legacyPainelPath(pathname: string): string | null {
  if (pathname === '/' || pathname === '') return '/painel'
  if (pathname === '/entrar' || pathname === '/esqueci-a-senha') return pathname
  if (pathname.startsWith('/_next/') || pathname === '/_next') return null
  if (pathname.startsWith('/arquivos/') || pathname.startsWith('/brand/')) return pathname
  if (pathname.startsWith('/redefinir-senha/')) return pathname
  if (pathname.startsWith('/definir-senha/')) return `/convite/${pathname.slice('/definir-senha/'.length)}`
  return `/painel${pathname}`
}

export function routeRequest(
  host: string | null | undefined,
  pathname: string,
  cfg: HostConfig,
): RouteDecision {
  // Verificação de saúde: responde em qualquer host (o Coolify chama o contêiner por localhost).
  if (pathname === '/healthz') return { action: 'pass' }
  if (isLegacyPainel(host, cfg)) {
    const destino = legacyPainelPath(pathname)
    return destino === null ? { action: 'not_found' } : { action: 'redirect', path: destino }
  }
  const area = resolveArea(host, cfg)
  if (area === null) return { action: 'not_found' }
  if (isPassthrough(pathname)) return { action: 'pass' }
  const primeiro = firstSegment(pathname)
  if (primeiro === null || (AREAS as readonly string[]).includes(primeiro)) {
    return { action: 'not_found' }
  }
  return { action: 'rewrite', to: pathname === '/' ? `/${area}` : `/${area}${pathname}` }
}

export function areaUrl(
  area: Area,
  path: string,
  cfg: Pick<HostConfig, Area>,
  protocol: 'http' | 'https',
): string {
  if (!path.startsWith('/')) throw new RangeError('O caminho da URL precisa começar com barra (/).')
  return `${protocol}://${cfg[area]}${path}`
}
