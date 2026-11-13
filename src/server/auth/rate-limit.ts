export type RateLimiter = {
  check(key: string): { allowed: boolean; retryAfterMs: number }
  reset(key: string): void
}

/** Janela deslizante em memória. Cada chamada permitida conta como uma tentativa. */
export function createRateLimiter(o: { limit: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = o.now ?? (() => Date.now())
  const attempts = new Map<string, number[]>()
  return {
    check(key) {
      const t = now()
      const recent = (attempts.get(key) ?? []).filter((at) => at > t - o.windowMs)
      const oldest = recent[0]
      if (recent.length >= o.limit && oldest !== undefined) {
        attempts.set(key, recent)
        return { allowed: false, retryAfterMs: Math.max(1, oldest + o.windowMs - t) }
      }
      recent.push(t)
      attempts.set(key, recent)
      return { allowed: true, retryAfterMs: 0 }
    },
    reset(key) {
      attempts.delete(key)
    },
  }
}
