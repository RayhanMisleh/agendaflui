/** O agendador (métricas de uso, avisos e limpezas) só sobe no runtime Node, fora do build e do teste. */
export function shouldRunInProcess(source: Record<string, string | undefined>): boolean {
  return (
    source['NEXT_RUNTIME'] === 'nodejs' && source['NEXT_PHASE'] !== 'phase-production-build' && source['NODE_ENV'] !== 'test'
  )
}

/** O envio de avisos e as limpezas só rodam se `WORKER_ENABLED` não for `false`; as métricas de uso rodam sempre. */
export function shouldStartWorker(source: Record<string, string | undefined>): boolean {
  return shouldRunInProcess(source) && source['WORKER_ENABLED'] !== 'false'
}

export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs' || process.env['NEXT_PHASE'] === 'phase-production-build') return
  // Falha cedo em produção (segredo de exemplo, remetente ausente) sem imprimir valores.
  const { parseEnv, productionWarnings } = await import('@/server/env')
  const config = parseEnv(process.env)
  if (config.NODE_ENV === 'production') {
    const { checkStorageDir } = await import('@/server/storage/check')
    await checkStorageDir(config.STORAGE_DIR)
    for (const aviso of productionWarnings(config)) console.warn(`[AVISO] ${aviso}`)
  }
  const { startScheduler } = await import('@/server/notifications/scheduler')
  startScheduler({ worker: shouldStartWorker(process.env) })
}
