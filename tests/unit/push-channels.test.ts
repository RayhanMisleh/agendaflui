import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ChannelError } from '@/server/notifications/channels/types'
import { createExpoChannel, EXPO_URL } from '@/server/notifications/channels/push-expo'
import { createPushFileChannel } from '@/server/notifications/channels/push-file'

const tok = (n: number) => `ExponentPushToken[${n}]`
const msg = (tokens: string[]) => ({ tokens, title: 'Oi', body: 'Corpo', data: { kind: 'X' } })

type Chamada = { url: string; init: RequestInit }
function falso(respostas: (c: Chamada, i: number) => Response | Promise<Response>) {
  const chamadas: Chamada[] = []
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(url), init: init ?? {} }
    chamadas.push(c)
    return respostas(c, chamadas.length - 1)
  }) as typeof fetch
  return { chamadas, fetchFn }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const tickets = (...t: Array<'ok' | 'DeviceNotRegistered' | 'MessageRateExceeded'>) => ({
  data: t.map((x) => (x === 'ok' ? { status: 'ok', id: 'r' } : { status: 'error', message: `falha com ${tok(1)}`, details: { error: x } })),
})

describe('canal Expo', () => {
  test('envia para a URL do Expo com JSON, sem Authorization quando não há token', async () => {
    const f = falso(() => json(tickets('ok', 'ok')))
    const r = await createExpoChannel({ fetch: f.fetchFn }).send(msg([tok(1), tok(2)]))
    expect(r).toEqual({ invalidTokens: [] })
    expect(f.chamadas).toHaveLength(1)
    expect(f.chamadas[0]!.url).toBe(EXPO_URL)
    expect(EXPO_URL).toBe('https://exp.host/--/api/v2/push/send')
    const h = new Headers(f.chamadas[0]!.init.headers)
    expect(h.get('authorization')).toBeNull()
    expect(h.get('content-type')).toContain('application/json')
    expect(JSON.parse(String(f.chamadas[0]!.init.body))).toEqual([
      { to: tok(1), title: 'Oi', body: 'Corpo', data: { kind: 'X' }, sound: 'default' },
      { to: tok(2), title: 'Oi', body: 'Corpo', data: { kind: 'X' }, sound: 'default' },
    ])
  })

  test('com EXPO_ACCESS_TOKEN manda Authorization: Bearer', async () => {
    const f = falso(() => json(tickets('ok')))
    await createExpoChannel({ fetch: f.fetchFn, accessToken: 'segredo-expo' }).send(msg([tok(1)]))
    expect(new Headers(f.chamadas[0]!.init.headers).get('authorization')).toBe('Bearer segredo-expo')
  })

  test('lotes de 100 tokens', async () => {
    const f = falso((_c, i) => json({ data: Array.from({ length: i === 2 ? 50 : 100 }, () => ({ status: 'ok' })) }))
    await createExpoChannel({ fetch: f.fetchFn }).send(msg(Array.from({ length: 250 }, (_, i) => tok(i))))
    expect(f.chamadas.map((c) => (JSON.parse(String(c.init.body)) as unknown[]).length)).toEqual([100, 100, 50])
  })

  test('DeviceNotRegistered marca o token como inválido (e só ele)', async () => {
    const f = falso(() => json(tickets('ok', 'DeviceNotRegistered', 'ok')))
    const r = await createExpoChannel({ fetch: f.fetchFn }).send(msg([tok(1), tok(2), tok(3)]))
    expect(r.invalidTokens).toEqual([tok(2)])
  })

  test('todos inválidos: devolve todos e não é falha', async () => {
    const f = falso(() => json(tickets('DeviceNotRegistered')))
    expect((await createExpoChannel({ fetch: f.fetchFn }).send(msg([tok(1)]))).invalidTokens).toEqual([tok(1)])
  })

  test('outro erro de ticket sem nenhum sucesso é falha do canal, sem a mensagem do provedor', async () => {
    const f = falso(() => json(tickets('MessageRateExceeded')))
    const erro = await createExpoChannel({ fetch: f.fetchFn }).send(msg([tok(1)])).then(() => null, (e: unknown) => e)
    expect(erro).toBeInstanceOf(ChannelError)
    expect((erro as ChannelError).code).toBe('channel_error')
    expect(String(erro)).not.toContain(tok(1))
  })

  test('se ao menos um ticket foi aceito, o envio vale (o resto é descartado)', async () => {
    const f = falso(() => json(tickets('ok', 'MessageRateExceeded')))
    expect(await createExpoChannel({ fetch: f.fetchFn }).send(msg([tok(1), tok(2)]))).toEqual({ invalidTokens: [] })
  })

  test('HTTP de erro, corpo inválido e rede caída são channel_error', async () => {
    for (const resp of [() => json({ errors: [] }, 500), () => new Response('<html>', { status: 200 }), () => json({ data: 'x' })]) {
      const f = falso(resp)
      const erro = await createExpoChannel({ fetch: f.fetchFn }).send(msg([tok(1)])).then(() => null, (e: unknown) => e)
      expect((erro as ChannelError).code).toBe('channel_error')
    }
    const caida = (async () => { throw new TypeError(`fetch failed ${tok(1)}`) }) as unknown as typeof fetch
    const erro = await createExpoChannel({ fetch: caida }).send(msg([tok(1)])).then(() => null, (e: unknown) => e)
    expect((erro as ChannelError).code).toBe('channel_error')
    expect(String(erro)).not.toContain(tok(1))
  })

  test('tempo limite de 10 s aborta a chamada e vira timeout', async () => {
    vi.useFakeTimers()
    try {
      let sinal: AbortSignal | undefined
      const pendente = (async (_u: string | URL | Request, init?: RequestInit) => {
        sinal = init?.signal ?? undefined
        return new Promise<Response>((_ok, falha) => sinal?.addEventListener('abort', () => falha(new DOMException('aborted', 'AbortError'))))
      }) as typeof fetch
      const p = createExpoChannel({ fetch: pendente }).send(msg([tok(1)])).then(() => null, (e: unknown) => e)
      await vi.advanceTimersByTimeAsync(9_999)
      expect(sinal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(2)
      const erro = await p
      expect(sinal?.aborted).toBe(true)
      expect((erro as ChannelError).code).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('canal push em arquivo', () => {
  test('grava um JSON por mensagem na pasta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'push-'))
    const r = await createPushFileChannel(join(dir, 'push')).send(msg([tok(1)]))
    expect(r).toEqual({ invalidTokens: [] })
    const [arq] = await readdir(join(dir, 'push'))
    expect(arq).toMatch(/\.json$/)
    expect(JSON.parse(await readFile(join(dir, 'push', arq!), 'utf8'))).toMatchObject({ tokens: [tok(1)], title: 'Oi', body: 'Corpo' })
  })
})
