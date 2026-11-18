import { clientIp, ipLimitKeyPart } from '@/server/auth/client-ip'
import { hitRateLimit, LIMITS, limitKey } from '@/server/auth/rate-limit-db'
import { handleMercadoPagoNotification } from '@/server/domain/store/payments'
import { env } from '@/server/env'

/*
 * Webhook do Mercado Pago. Rota simples, fora do OpenAPI e sem chave de app: a conta vem da chave do endereço e a assinatura
 * é conferida pelo domínio. O corpo NUNCA é lido (a situação do pagamento vem de uma consulta à API do Mercado Pago). A
 * resposta é sempre sem corpo e sem detalhe.
 */

const vazia = (status: number, extra: Record<string, string> = {}): Response => new Response(null, { status, headers: { 'cache-control': 'no-store', ...extra } })

export async function POST(request: Request, seg: { params: Promise<{ webhookKey: string }> }): Promise<Response> {
  try {
    const ip = clientIp(request.headers, env.TRUSTED_PROXY_HOPS)
    // Sem IP confiável não há como separar quem chama: não conta (um balde só deixaria um atacante calar o Mercado Pago).
    if (ip !== null) {
      const r = await hitRateLimit(limitKey('webhook-mp', ipLimitKeyPart(ip)), LIMITS.webhookIp, new Date())
      if (!r.allowed) return vazia(429, { 'retry-after': String(r.retryAfterSec) })
    }
    const { webhookKey } = await seg.params
    const url = new URL(request.url)
    const result = await handleMercadoPagoNotification({
      webhookKey,
      dataId: url.searchParams.get('data.id'),
      type: url.searchParams.get('type'),
      xSignature: request.headers.get('x-signature'),
      xRequestId: request.headers.get('x-request-id'),
    })
    return vazia(result.status)
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', event: 'mp_webhook_error', error: err instanceof Error ? err.name : 'unknown' }))
    return vazia(500)
  }
}
