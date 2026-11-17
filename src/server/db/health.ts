import { prisma } from './client'

const LIMITE_PADRAO_MS = 2000
const SEM_CACHE = { 'Cache-Control': 'no-store' }

/** `SELECT 1` no banco de verdade. */
async function perguntarAoBanco(): Promise<void> {
  await prisma.$queryRaw`SELECT 1`
}

/** `true` se `ping` termina sem erro dentro do limite. */
async function respondeAntesDe(ping: () => Promise<void>, limiteMs: number): Promise<boolean> {
  let relogio: NodeJS.Timeout | undefined
  const prazo = new Promise<false>((ok) => {
    relogio = setTimeout(() => ok(false), limiteMs)
  })
  try {
    return await Promise.race([ping().then(() => true as const), prazo])
  } catch {
    return false
  } finally {
    clearTimeout(relogio)
  }
}

/**
 * Resposta da verificação de saúde: 200 com o banco respondendo, 503 sem detalhe nenhum se ele falhar ou demorar.
 * `ping` e o limite são parâmetros só para o teste simular um banco fora do ar.
 */
export function createHealthHandler(
  ping: () => Promise<void> = perguntarAoBanco,
  limiteMs: number = LIMITE_PADRAO_MS,
): () => Promise<Response> {
  return async () => {
    const ok = await respondeAntesDe(ping, limiteMs)
    return Response.json({ status: ok ? 'ok' : 'degraded' }, { status: ok ? 200 : 503, headers: SEM_CACHE })
  }
}
