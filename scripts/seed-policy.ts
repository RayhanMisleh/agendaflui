const SEED_VARS = ['SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'SEED_USER_PASSWORD', 'SEED_MULTI_EMAIL'] as const

export type SeedPlan = { run: true } | { run: false } | { run: false; error: string }

/**
 * Decide o que o `npm run dev` faz com o seed. Com as variáveis, roda (ele só cria o que falta). Sem elas,
 * um banco que já tem contas segue sem seed; um banco vazio não tem como ser preparado e vira erro.
 */
export function planSeed(env: Record<string, string | undefined>, businessCount: number): SeedPlan {
  const missing = SEED_VARS.filter((name) => !env[name])
  if (missing.length === 0) return { run: true }
  if (businessCount > 0) return { run: false }
  return {
    run: false,
    error: `O banco está vazio e faltam variáveis para os dados de demonstração (${missing.join(', ')}): copie-as do .env.example para o .env e rode de novo.`,
  }
}
