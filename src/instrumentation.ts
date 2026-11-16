/** O agendador de avisos só roda no runtime Node, fora do build e do teste, e se `WORKER_ENABLED` não for `false`. */
export function shouldStartWorker(source: Record<string, string | undefined>): boolean {
  return (
    source['NEXT_RUNTIME'] === 'nodejs' &&
    source['NEXT_PHASE'] !== 'phase-production-build' &&
    source['NODE_ENV'] !== 'test' &&
    source['WORKER_ENABLED'] !== 'false'
  )
}

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs' || process.env['NEXT_PHASE'] === 'phase-production-build') return
  // Falha cedo em produção (segredo de exemplo, remetente ausente) sem imprimir valores.
  const { parseEnv } = await import('@/server/env')
  parseEnv(process.env)
  if (!shouldStartWorker(process.env)) return
  const { startScheduler } = await import('@/server/notifications/scheduler')
  startScheduler()
}
