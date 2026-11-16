import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(32),
  DEV_HOST: z.string().min(1).default('dev.localhost:3000'),
  PAINEL_HOST: z.string().min(1).default('painel.localhost:3000'),
  API_HOST: z.string().min(1).default('api.localhost:3000'),
  STORAGE_DIR: z.string().min(1).default('.local/storage'),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

// Marcador estável do segredo de exemplo do .env.example; em produção ele nunca pode valer.
const MARCADOR_DE_EXEMPLO = 'EXEMPLO-'

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema
    .refine((v) => !(v.NODE_ENV === 'production' && v.APP_SECRET.startsWith(MARCADOR_DE_EXEMPLO)), {
      path: ['APP_SECRET'],
      message: 'em produção, troque o valor de exemplo por um segredo aleatório (ex.: openssl rand -hex 32)',
    })
    .safeParse(source)
  if (!result.success) {
    const problemas = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    throw new Error(
      `Variáveis de ambiente inválidas (${problemas}). Confira o arquivo .env com base no .env.example.`,
    )
  }
  return result.data
}

let cache: Env | undefined

/** Avaliado sob demanda: só lê process.env no primeiro acesso. */
export const env: Env = new Proxy({} as Env, {
  get(_alvo, chave) {
    cache ??= parseEnv(process.env)
    return cache[chave as keyof Env]
  },
})
