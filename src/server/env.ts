import { z } from 'zod'
import { DEFAULT_HOSTS } from './hosts'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  // Segunda URL do banco, sem pooler: as migrações usam esta quando existe.
  DIRECT_URL: z.string().min(1).optional(),
  // `true` leva também o servidor para a DIRECT_URL (quando o pooler não mantém o fuso UTC da sessão).
  DATABASE_USE_DIRECT_URL: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  APP_SECRET: z.string().min(32),
  DEV_HOST: z.string().min(1).default(DEFAULT_HOSTS.dev),
  PAINEL_HOST: z.string().min(1).default(DEFAULT_HOSTS.painel),
  API_HOST: z.string().min(1).default(DEFAULT_HOSTS.api),
  STORAGE_DIR: z.string().min(1).default('.local/storage'),
  // Canal de e-mail: em produção, SMTP_URL liga o envio (smtp://usuario:senha@host:587); em desenvolvimento os e-mails vão para .local/mail.
  SMTP_URL: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  // Push pelo Expo: o token de acesso é opcional (só vale se a conta Expo exigir).
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
  // Agendador de avisos dentro do servidor; `false` desliga (por exemplo, numa instância só de leitura).
  WORKER_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // Chave das Server Actions do Next (base64 de 32 bytes): o Next a lê direto do ambiente; aqui só para o aviso da partida.
  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.string().min(1).optional(),
  // Definida pelo Next; só interessa para distinguir o `next build` da execução em produção.
  NEXT_PHASE: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Serviços externos (Mercado Pago, Frenet, ViaCEP): `real` chama os serviços, `fake` usa as implementações falsas. Sem a
  // variável, produção usa `real` e o resto usa `fake`; `fake` em produção é erro de partida.
  INTEGRATIONS_MODE: z.enum(['real', 'fake']).optional(),
})

// Marcador estável do segredo de exemplo do .env.example; em produção ele nunca pode valer.
// Durante o `next build` a recusa não vale (o build só precisa carregar os módulos).
const FASE_DE_BUILD = 'phase-production-build'
const MARCADOR_DE_EXEMPLO = 'EXEMPLO-'

/** Remetente padrão (só desenvolvimento e teste; produção com SMTP exige `MAIL_FROM`). */
export const DEFAULT_MAIL_FROM = 'Agenda Flui <nao-responda@agendaflui.localhost>'

export type Env = Omit<z.infer<typeof envSchema>, 'INTEGRATIONS_MODE'> & { INTEGRATIONS_MODE: 'real' | 'fake' }

type UrlsDoBanco = Pick<Env, 'DATABASE_URL' | 'DIRECT_URL' | 'DATABASE_USE_DIRECT_URL'>

/** URL que o servidor em execução usa: o único ponto que decide entre DATABASE_URL e DIRECT_URL. */
export function runtimeDatabaseUrl(e: UrlsDoBanco): string {
  return e.DATABASE_USE_DIRECT_URL && e.DIRECT_URL ? e.DIRECT_URL : e.DATABASE_URL
}

/** URL das migrações: DIRECT_URL quando existe (prisma.config.ts aplica a mesma regra). */
export function migrationDatabaseUrl(e: UrlsDoBanco): string {
  return e.DIRECT_URL ?? e.DATABASE_URL
}

const NOMES_DOS_HOSTS = ['DEV_HOST', 'PAINEL_HOST', 'API_HOST'] as const

function normalizarHost(valor: string): string {
  return valor.trim().toLowerCase().replace(/\.$/, '')
}

/** Host sem a porta; aceita IPv6 entre colchetes. */
function nomeDoHost(valor: string): string {
  const colchetes = /^\[([^\]]+)\](?::\d+)?$/.exec(valor)
  return colchetes?.[1] ?? valor.replace(/:\d+$/, '')
}

function ehHostLocal(valor: string): boolean {
  const nome = nomeDoHost(valor)
  return nome === 'localhost' || nome.endsWith('.localhost') || nome === '::1' || /^127\./.test(nome)
}

/** Regras só de produção para os três hosts. Os valores nunca entram nas mensagens. */
function problemasDosHosts(source: Record<string, string | undefined>): string[] {
  const problemas: string[] = []
  const vistos = new Map<string, string>()
  for (const nome of NOMES_DOS_HOSTS) {
    const bruto = source[nome]
    if (bruto === undefined || bruto.trim() === '') {
      problemas.push(`${nome}: obrigatório em produção (o endereço público, ex.: ${nome === 'API_HOST' ? 'api' : nome === 'DEV_HOST' ? 'dev' : 'painel'}.seudominio.com)`)
      continue
    }
    const host = normalizarHost(bruto)
    if (/[/\s]/.test(host)) {
      problemas.push(`${nome}: informe só o host, sem https:// nem barra`)
    } else if (ehHostLocal(host)) {
      problemas.push(`${nome}: em produção não pode ser localhost nem endereço local`)
    }
    const igual = vistos.get(host)
    if (igual) problemas.push(`${nome}: precisa ser diferente de ${igual}`)
    else vistos.set(host, nome)
  }
  return problemas
}

function falhar(problemas: string): never {
  throw new Error(`Variáveis de ambiente inválidas (${problemas}). Confira o arquivo .env com base no .env.example.`)
}

/** Avisos altos da partida em produção: não impedem o servidor de subir. */
export function productionWarnings(config: Env): string[] {
  if (config.NODE_ENV !== 'production') return []
  const avisos: string[] = []
  if (config.TRUSTED_PROXY_HOPS === 0) {
    avisos.push('TRUSTED_PROXY_HOPS=0: sem proxy confiável, limites por IP desligados e auditoria sem IP. Atrás do proxy do Coolify use TRUSTED_PROXY_HOPS=1.')
  }
  if (config.SMTP_URL === undefined) {
    avisos.push('SMTP_URL ausente: sem envio de e-mail, convites e cadastro pelo app não chegam.')
  }
  if (config.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY === undefined) {
    avisos.push('NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ausente na execução: a chave precisa estar disponível no build (build arg) e na execução, igual em todas as instâncias; sem ela, builds diferentes ou várias instâncias fazem as ações do painel falharem entre si (base64 de 32 bytes).')
  }
  return avisos
}

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
    .refine((v) => !(v.NODE_ENV === 'production' && v.NEXT_PHASE !== FASE_DE_BUILD && v.INTEGRATIONS_MODE === 'fake'), {
      path: ['INTEGRATIONS_MODE'],
      message: 'em produção só vale `real` (ou deixe sem a variável); `fake` é para desenvolvimento e teste',
    })
    .refine((v) => !(v.DATABASE_USE_DIRECT_URL && v.DIRECT_URL === undefined), {
      path: ['DATABASE_USE_DIRECT_URL'],
      message: 'só vale com DIRECT_URL definida',
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
    falhar(problemas)
  }
  const { data } = result
  if (data.NODE_ENV === 'production' && data.NEXT_PHASE !== FASE_DE_BUILD) {
    const problemas = problemasDosHosts(source)
    if (problemas.length > 0) falhar(problemas.join('; '))
  }
  return { ...data, INTEGRATIONS_MODE: data.INTEGRATIONS_MODE ?? (data.NODE_ENV === 'production' ? 'real' : 'fake') }
}

let cache: Env | undefined

/** Avaliado sob demanda: só lê process.env no primeiro acesso. */
export const env: Env = new Proxy({} as Env, {
  get(_alvo, chave) {
    cache ??= parseEnv(process.env)
    return cache[chave as keyof Env]
  },
})
