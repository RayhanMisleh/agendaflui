export type RateLimiter = {
  check(key: string): { allowed: boolean; retryAfterMs: number }
  reset(key: string): void
  /** Quantas chaves o limitador guarda agora. */
  size(): number
}

const TETO_DE_CHAVES = 10_000

/**
 * Janela deslizante em memória. Cada chamada permitida conta como uma tentativa.
 * A memória é limitada: chave sem tentativa na janela é removida, e acima de `maxKeys` (10.000)
 * as chaves com a tentativa mais antiga saem primeiro.
 */
export function createRateLimiter(o: {
  limit: number
  windowMs: number
  maxKeys?: number
  now?: () => number
}): RateLimiter {
  const now = o.now ?? (() => Date.now())
  const maxKeys = o.maxKeys ?? TETO_DE_CHAVES
  // A ordem do Map é a da última tentativa permitida de cada chave (a mais antiga primeiro).
  const attempts = new Map<string, number[]>()

  function limparExpiradas(t: number): void {
    for (const [key, lista] of attempts) {
      const ultima = lista[lista.length - 1]
      if (ultima !== undefined && ultima > t - o.windowMs) break
      attempts.delete(key)
    }
  }

  return {
    check(key) {
      const t = now()
      limparExpiradas(t)
      const recent = (attempts.get(key) ?? []).filter((at) => at > t - o.windowMs)
      const oldest = recent[0]
      if (recent.length >= o.limit && oldest !== undefined) {
        attempts.set(key, recent)
        return { allowed: false, retryAfterMs: Math.max(1, oldest + o.windowMs - t) }
      }
      recent.push(t)
      attempts.delete(key)
      attempts.set(key, recent)
      for (const antiga of attempts.keys()) {
        if (attempts.size <= maxKeys) break
        attempts.delete(antiga)
      }
      return { allowed: true, retryAfterMs: 0 }
    },
    reset(key) {
      attempts.delete(key)
    },
    size() {
      return attempts.size
    },
  }
}
