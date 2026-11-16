import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_SECRET: z.string().min(32),
  DEV_HOST: z.string().min(1).default('dev.localhost:3000'),
  PAINEL_HOST: z.string().min(1).default('painel.localhost:3000'),
  API_HOST: z.string().min(1).default('api.localhost:3000'),
  STORAGE_DIR: z.string().min(1).default('.local/storage'),
  // Canal de e-mail: em produção, SMTP_URL liga o envio (smtp://usuario:senha@host:587); em desenvolvimento os e-mails vão para .local/mail.
  SMTP_URL: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Definida pelo Next; só interessa para distinguir o `next build` da execução em produção.
  NEXT_PHASE: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

// Marcador estável do segredo de exemplo do .env.example; em produção ele nunca pode valer.
// Durante o `next build` a recusa não vale (o build só precisa carregar os módulos).
const FASE_DE_BUILD = 'phase-production-build'
const MARCADOR_DE_EXEMPLO = 'EXEMPLO-'

/** Remetente padrão (só desenvolvimento e teste; produção com SMTP exige `MAIL_FROM`). */
export const DEFAULT_MAIL_FROM = 'AgendaFlui <nao-responda@agendaflui.localhost>'

export type Env = z.infer<typeof envSchema>

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema
    .refine((v) => !(
        v.NODE_ENV === 'production' &&
        v.NEXT_PHASE !== FASE_DE_BUILD &&
        v.APP_SECRET.startsWith(MARCADOR_DE_EXEMPLO)
      ), {
      path: ['APP_SECRET'],
      message: 'em produção, troque o valor de exemplo por um segredo aleatório (ex.: openssl rand -hex 32)',
    })
    .refine((v) => !(v.NODE_ENV === 'production' && v.NEXT_PHASE !== FASE_DE_BUILD && v.SMTP_URL !== undefined && v.MAIL_FROM === undefined), {
      path: ['MAIL_FROM'],
      message: 'em produção com SMTP_URL, informe o remetente (ex.: "Conta <contato@seudominio.com>")',
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
