import 'server-only'
import type { RequestMeta } from '@/server/auth/api-tokens'
import { clientIp } from '@/server/auth/client-ip'
import { env } from '@/server/env'

const MAX_USER_AGENT = 300

/** IP (só o que um proxy confiável garante) e user agent da requisição, para gravar nas sessões do app. */
export function requestMeta(request: Request): RequestMeta {
  return {
    ip: clientIp(request.headers, env.TRUSTED_PROXY_HOPS),
    userAgent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT) ?? null,
  }
}
