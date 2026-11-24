import { IntegrationError } from './errors'

/**
 * Chama `fetch` com tempo limite que cobre a resposta INTEIRA: cabeçalhos e leitura do corpo. Uma resposta 2xx tem o corpo lido
 * aqui, dentro da corrida com o relógio, e devolvida já pronta (um corpo que trava vira `timeout`, não um pedido pendurado). Resposta
 * de erro não tem o corpo lido (ninguém o usa) e é cancelada. O limite vale mesmo que o `fetch` ignore o aborto (a corrida com o
 * relógio devolve `timeout` do mesmo jeito) e o relógio é um `setTimeout` comum, que os testes podem adiantar. Falha de rede vira
 * `unavailable`. Nunca repassa o texto do erro original (pode trazer endereço e dado do cliente). Com `keepErrorBody`, a resposta de
 * erro também tem o corpo lido (dentro da mesma corrida com o relógio) para quem precisa do motivo; ele nunca vai para mensagem.
 */
export async function fetchWithTimeout(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  servico: string,
  keepErrorBody = false,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expirou = new Promise<never>((_ok, falha) => {
    timer = setTimeout(() => {
      controller.abort()
      falha(new IntegrationError('timeout', `${servico} não respondeu a tempo.`))
    }, timeoutMs)
  })
  const lerTudo = async (): Promise<Response> => {
    const res = await doFetch(url, { ...init, signal: controller.signal }).catch((err: unknown) => {
      if (err instanceof IntegrationError) throw err
      // O aborto do nosso relógio já rejeitou `expirou`; qualquer outra falha é de rede.
      throw new IntegrationError('unavailable', `${servico} está fora do ar.`)
    })
    if (!res.ok && keepErrorBody) {
      const corpo = await res.text().catch(() => '')
      return new Response(corpo === '' ? null : corpo, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => undefined)
      return new Response(null, { status: res.status, statusText: res.statusText, headers: res.headers })
    }
    const texto = await res.text().catch(() => {
      throw new IntegrationError('unavailable', `${servico} está fora do ar.`)
    })
    return new Response(texto === '' ? null : texto, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
  try {
    return await Promise.race([lerTudo(), expirou])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Lê o corpo como JSON; qualquer coisa que não seja JSON vira `invalid_response`. */
export async function readJson(res: Response, servico: string): Promise<unknown> {
  try {
    return (await res.json()) as unknown
  } catch {
    throw new IntegrationError('invalid_response', `${servico} respondeu em um formato inesperado.`)
  }
}
