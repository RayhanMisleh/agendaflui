import 'server-only'
import { assertSafeRecipient, ChannelError, fromHeader, type EmailChannel } from './types'

const ENDERECO_DA_API = 'https://api.resend.com/emails'
// Abaixo do teto de 30 s do envio na rodada: o envio não continua vivo depois que a rodada desistiu dele.
const TEMPO_LIMITE_MS = 20_000

/**
 * Canal de produção pelo Resend (API HTTP). O domínio do remetente (`MAIL_FROM`) precisa estar verificado no Resend.
 * Qualquer falha vira `ChannelError` com código curto: nunca o corpo da resposta nem a mensagem do erro de rede, que
 * podem trazer o destinatário.
 */
export function createResendChannel(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailChannel {
  return {
    async send(msg) {
      assertSafeRecipient(msg.to)
      const { name, address } = fromHeader(from, msg.fromName)
      let resposta: Response
      try {
        resposta = await fetchImpl(ENDERECO_DA_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: name ? `"${name.replace(/(["\\])/g, '\\$1')}" <${address}>` : address, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
          signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        })
      } catch (err) {
        throw new ChannelError(err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? 'timeout' : 'channel_error')
      }
      if (!resposta.ok) {
        // Descarta o corpo sem lê-lo: nada da resposta entra em erro nem em log.
        await resposta.body?.cancel().catch(() => undefined)
        throw new ChannelError('channel_error')
      }
    },
  }
}
