// Roda uma rodada de envio de avisos e sai. Precisa do banco já de pé (por exemplo, o de `npm run dev`) e do .env.
try {
  process.loadEnvFile()
} catch {
  // Sem .env: valem as variáveis do ambiente.
}

async function main(): Promise<void> {
  const { processDueNotifications } = await import('../src/server/notifications/worker')
  const { prisma } = await import('../src/server/db/client')
  try {
    const r = await processDueNotifications()
    console.log(`Avisos: ${r.sent} enviados, ${r.skipped} descartados, ${r.failed} com falha, ${r.retried} para nova tentativa.`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err: unknown) => {
  console.error(`Não foi possível rodar os avisos: ${err instanceof Error ? err.name : 'erro desconhecido'}.`)
  process.exit(1)
})
