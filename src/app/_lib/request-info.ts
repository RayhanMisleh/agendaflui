import { headers } from 'next/headers'

/** IP e navegador da requisição, para gravar na sessão. */
export async function requestInfo(): Promise<{ ip?: string; userAgent?: string }> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  const userAgent = h.get('user-agent')?.slice(0, 300)
  return { ...(ip ? { ip } : {}), ...(userAgent ? { userAgent } : {}) }
}
