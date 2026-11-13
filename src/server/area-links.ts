import { areaUrl, type Area } from './hosts'
import { env } from './env'

/** Endereço absoluto de uma rota de uma das áreas, montado com os hosts do ambiente. */
export function areaLink(area: Area, path: string): string {
  return areaUrl(area, path, { dev: env.DEV_HOST, painel: env.PAINEL_HOST, api: env.API_HOST }, env.NODE_ENV === 'production' ? 'https' : 'http')
}
