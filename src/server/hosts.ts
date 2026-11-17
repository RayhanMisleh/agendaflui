export type Area = 'dev' | 'painel' | 'api'
export type HostConfig = { dev: string; painel: string; api: string }
export type RouteDecision =
  | { action: 'rewrite'; to: string }
  | { action: 'pass' }
  | { action: 'not_found' }

const AREAS: readonly Area[] = ['dev', 'painel', 'api']

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '')
}

export function resolveArea(host: string | null | undefined, cfg: HostConfig): Area | null {
  if (!host) return null
  const alvo = normalizeHost(host)
  if (alvo === '') return null
  return AREAS.find((area) => normalizeHost(cfg[area]) === alvo) ?? null
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

export function routeRequest(
  host: string | null | undefined,
  pathname: string,
  cfg: HostConfig,
): RouteDecision {
  // Verificação de saúde: responde em qualquer host (o Coolify chama o contêiner por localhost).
  if (pathname === '/healthz') return { action: 'pass' }
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
  cfg: HostConfig,
  protocol: 'http' | 'https',
): string {
  if (!path.startsWith('/')) throw new RangeError('O caminho da URL precisa começar com barra (/).')
  return `${protocol}://${cfg[area]}${path}`
}
