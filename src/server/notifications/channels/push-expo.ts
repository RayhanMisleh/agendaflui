import 'server-only'
import { ChannelError, type PushChannel } from './types'

export const EXPO_URL = 'https://exp.host/--/api/v2/push/send'
const BATCH = 100
const TIMEOUT_MS = 10_000

type Options = { fetch?: typeof fetch; accessToken?: string | undefined }

type Ticket = { status?: unknown; details?: { error?: unknown } }

/** Manda um lote e devolve o resultado por token. Nunca repete a mensagem do provedor nem o token em erro. */
async function sendBatch(fetchFn: typeof fetch, accessToken: string | undefined, url: string, body: unknown): Promise<Ticket[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
    if (accessToken) headers['authorization'] = `Bearer ${accessToken}`
    const res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
    if (!res.ok) throw new ChannelError('channel_error')
    const json: unknown = await res.json().catch(() => null)
    const data = typeof json === 'object' && json !== null ? (json as { data?: unknown }).data : undefined
    if (!Array.isArray(data)) throw new ChannelError('channel_error')
    return data as Ticket[]
  } catch (err) {
    if (err instanceof ChannelError) throw err
    throw new ChannelError(controller.signal.aborted ? 'timeout' : 'channel_error')
  } finally {
    clearTimeout(timer)
  }
}

/** Canal de produção: API de push do Expo, em lotes de 100, com tempo limite de 10 s por lote. */
export function createExpoChannel(o: Options = {}): PushChannel {
  const fetchFn = o.fetch ?? fetch
  return {
    async send(msg) {
      const invalidTokens: string[] = []
      let accepted = 0
      let failed = 0
      for (let i = 0; i < msg.tokens.length; i += BATCH) {
        const tokens = msg.tokens.slice(i, i + BATCH)
        const body = tokens.map((to) => ({ to, title: msg.title, body: msg.body, data: msg.data, sound: 'default' }))
        const tickets = await sendBatch(fetchFn, o.accessToken, EXPO_URL, body)
        if (tickets.length !== tokens.length) throw new ChannelError('channel_error')
        tickets.forEach((t, k) => {
          const token = tokens[k]
          if (t.status === 'ok') accepted += 1
          else if (t.details?.error === 'DeviceNotRegistered' && token !== undefined) invalidTokens.push(token)
          else failed += 1
        })
      }
      // Nada saiu e houve erro que não é token morto: falha do canal (nova tentativa). Se algo saiu, o aviso vale.
      if (accepted === 0 && failed > 0) throw new ChannelError('channel_error')
      return { invalidTokens }
    },
  }
}
