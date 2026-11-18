import { IntegrationError } from './errors'

/**
 * Chama `fetch` com tempo limite. O limite vale mesmo que o `fetch` ignore o aborto (a corrida com o relógio devolve
 * `timeout` do mesmo jeito) e o relógio é um `setTimeout` comum, que os testes podem adiantar. Falha de rede vira
 * `unavailable`. Nunca repassa o texto do erro original (pode trazer endereço e dado do cliente).
 */
export async function fetchWithTimeout(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  servico: string,
): Promise<Response> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expirou = new Promise<never>((_ok, falha) => {
    timer = setTimeout(() => {
      controller.abort()
      falha(new IntegrationError('timeout', `${servico} não respondeu a tempo.`))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      doFetch(url, { ...init, signal: controller.signal }).catch((err: unknown) => {
        if (err instanceof IntegrationError) throw err
        // O aborto do nosso relógio já rejeitou `expirou`; qualquer outra falha é de rede.
        throw new IntegrationError('unavailable', `${servico} está fora do ar.`)
      }),
      expirou,
    ])
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
