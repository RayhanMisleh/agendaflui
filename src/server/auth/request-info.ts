import 'server-only'
import { headers } from 'next/headers'
import { env } from '@/server/env'
import { clientIp } from './client-ip'

/** IP (só o que um proxy confiável garante) e navegador da requisição, para gravar na sessão. */
export async function requestInfo(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers()
  const ip = clientIp(h, env.TRUSTED_PROXY_HOPS)
  const userAgent = h.get('user-agent')?.slice(0, 300)
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) }
}
