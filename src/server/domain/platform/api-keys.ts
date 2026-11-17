import 'server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { domainToASCII } from 'node:url'
import type { Actor } from '@/server/auth/actor'
import { hashToken } from '@/server/auth/tokens'
import { prisma } from '@/server/db/client'
import type { ApiKey, ApiKeyKind, Prisma } from '@/server/db/generated/client'
import { addMinutes } from '@/server/time'
import { DomainError, orNotFound, parse, z, type ApiReason } from '../errors'

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

export type ApiKeyView = {
  id: string
  kind: 'ACCOUNT' | 'PLATFORM'
  businessId: string | null
  name: string
  prefix: string
  allowedOrigins: string[]
  lastUsedAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export type ResolvedKey = {
  apiKeyId: string
  kind: 'ACCOUNT' | 'PLATFORM'
  businessId: string
  businessSlug: string
  timeZone: string
  allowedOrigins: string[]
}

/** Falha de autenticação da chave de app. As rotas HTTP mapeiam para 401, 403 e 503. */
export class ApiAuthError extends Error {
  code: 'unauthorized' | 'forbidden' | 'business_unavailable'
  reason: ApiReason
  constructor(code: ApiAuthError['code'], reason: ApiReason, message: string) {
    super(message)
    this.name = 'ApiAuthError'
    this.code = code
    this.reason = reason
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORMATO_CHAVE = /^afk_([ap])_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/
const ORIGEM = /^(https?):\/\/(\*\.)?([^\s/?#@:*]+)(?::(\d{1,5}))?$/
const ROTULO = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const MAX_ORIGEM_CHARS = 300
const TENTATIVAS_PREFIXO = 3
const MAX_ORIGENS = 20
const INTERVALO_USO_MIN = 1
// Hash fixo para comparar quando o prefixo não existe: o trabalho é o mesmo nos dois casos.
const HASH_FALSO = hashToken('afk_a_00000000_chave-que-nunca-existe')

const MSG_ORIGEM =
  'Use origens como https://app.exemplo.com, sem caminho. Só localhost (e *.localhost) aceita http://.'

/** Normaliza uma origem (`https://host[:porta]`, host em punycode, sem porta padrão). Devolve `null` se não for aceita. */
function normalizarOrigem(bruta: string): string | null {
  // Barra invertida e `%` mudam o host depois da normalização (`https://evil.com\\.good.com` viraria `https://evil.com`).
  if (bruta.length > MAX_ORIGEM_CHARS || /[\\%]/.test(bruta)) return null
  const texto = bruta.trim().replace(/\/$/, '').toLowerCase()
  const m = ORIGEM.exec(texto)
  if (!m) return null
  const [, esquema, curinga, hostBruto, porta] = m
  if (!esquema || !hostBruto) return null
  const host = domainToASCII(hostBruto)
  if (host === '' || host.length > 253 || !host.split('.').every((r) => r.length <= 63 && ROTULO.test(r))) return null
  const ehLocal = host === 'localhost' || host.endsWith('.localhost')
  if (curinga && (host !== 'localhost' || esquema !== 'http')) return null
  if (esquema === 'http' && !ehLocal) return null
  let sufixo = ''
  if (porta !== undefined) {
    const n = Number(porta)
    if (n < 1 || n > 65535) return null
    if (!((esquema === 'https' && n === 443) || (esquema === 'http' && n === 80))) sufixo = `:${n}`
  }
  return `${esquema}://${curinga ?? ''}${host}${sufixo}`
}

const origensSchema = z
  .array(z.string())
  .transform((lista, ctx) => {
    const vistas = new Set<string>()
    for (const [i, bruta] of lista.entries()) {
      const origem = normalizarOrigem(bruta)
      if (origem === null) {
        ctx.addIssue({ code: 'custom', message: MSG_ORIGEM, path: [i] })
        return z.NEVER
      }
      vistas.add(origem)
    }
    if (vistas.size > MAX_ORIGENS) {
      ctx.addIssue({ code: 'custom', message: `Informe no máximo ${MAX_ORIGENS} origens.` })
      return z.NEVER
    }
    return [...vistas]
  })

const criarSchema = z.object({
  kind: z.enum(['ACCOUNT', 'PLATFORM']),
  businessId: z.uuid().optional(),
  name: z.string().trim().min(1, 'Informe o nome da chave.').max(80, 'Use no máximo 80 caracteres.'),
  allowedOrigins: origensSchema.default([]),
})

/** Pré-validação do nome da chave com o mesmo esquema de `createApiKey`; `null` se está certo. */
export function validateApiKeyName(name: string): string | null {
  const r = criarSchema.shape.name.safeParse(name)
  return r.success ? null : (r.error.issues[0]?.message ?? 'Informe o nome da chave.')
}

/** Instante de referência: o passado por parâmetro (testes) ou o relógio do sistema. Único jeito neste módulo. */
function agoraDe(now?: Date): Date {
  return now ?? new Date()
}

function exigirAdmin(actor: PlatformAdminActor): void {
  if (actor.kind !== 'platform_admin') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

function paraView(k: ApiKey): ApiKeyView {
  return {
    id: k.id,
    kind: k.kind,
    businessId: k.businessId,
    name: k.name,
    prefix: k.prefix,
    allowedOrigins: k.allowedOrigins,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  }
}

function registrar(
  tx: Prisma.TransactionClient,
  actor: PlatformAdminActor,
  action: string,
  key: { id: string; businessId: string | null },
  metadata: Prisma.InputJsonObject = {},
) {
  return tx.auditLog.create({
    data: {
      businessId: key.businessId,
      actorType: 'PLATFORM_ADMIN',
      actorId: actor.adminId,
      actorName: actor.name,
      onBehalf: false,
      action,
      targetType: 'api_key',
      targetId: key.id,
      metadata,
    },
  })
}

function gerarChave(kind: ApiKeyKind, bytes: (n: number) => Buffer): { secret: string; prefix: string } {
  const prefix = bytes(4).toString('hex')
  const secret = `afk_${kind === 'ACCOUNT' ? 'a' : 'p'}_${prefix}_${bytes(32).toString('base64url')}`
  return { secret, prefix }
}

function colisaoDePrefixo(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002' && JSON.stringify((err as { meta?: unknown }).meta ?? {}).includes('prefix')
  )
}

/** Cria a chave. O segredo só existe no retorno: o banco guarda o prefixo e o hash. */
export async function createApiKey(
  actor: PlatformAdminActor,
  input: { kind: 'ACCOUNT' | 'PLATFORM'; businessId?: string; name: string; allowedOrigins?: string[] },
  opts: { randomBytes?: (n: number) => Buffer } = {},
): Promise<{ key: ApiKeyView; secret: string }> {
  exigirAdmin(actor)
  const i = parse(criarSchema, input)
  if (i.kind === 'PLATFORM' && i.businessId !== undefined) {
    throw new DomainError('validation', 'Chave de plataforma não pertence a uma conta. Tire a conta ou crie uma chave de conta.', {
      fields: { businessId: 'Chave de plataforma não pertence a uma conta.' },
    })
  }
  if (i.kind === 'ACCOUNT') {
    if (i.businessId === undefined) {
      throw new DomainError('validation', 'Escolha a conta da chave.', { fields: { businessId: 'Escolha a conta da chave.' } })
    }
    orNotFound(await prisma.business.findUnique({ where: { id: i.businessId }, select: { id: true } }), 'Conta')
  }
  for (let tentativa = 1; ; tentativa++) {
    const { secret, prefix } = gerarChave(i.kind, opts.randomBytes ?? randomBytes)
    try {
      const criada = await prisma.$transaction(async (tx) => {
        const k = await tx.apiKey.create({
          data: {
            kind: i.kind,
            businessId: i.businessId ?? null,
            name: i.name,
            prefix,
            keyHash: hashToken(secret),
            allowedOrigins: i.allowedOrigins,
            createdByAdminId: actor.adminId,
          },
        })
        await registrar(tx, actor, 'api_key.created', k, { kind: k.kind, name: k.name, prefix: k.prefix })
        return k
      })
      return { key: paraView(criada), secret }
    } catch (err) {
      if (!colisaoDePrefixo(err) || tentativa >= TENTATIVAS_PREFIXO) throw err
    }
  }
}

export async function listApiKeys(actor: PlatformAdminActor, q: { businessId?: string } = {}): Promise<ApiKeyView[]> {
  exigirAdmin(actor)
  if (q.businessId !== undefined && !UUID.test(q.businessId)) return []
  const linhas = await prisma.apiKey.findMany({
    where: q.businessId !== undefined ? { businessId: q.businessId } : {},
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return linhas.map(paraView)
}

function idValido(id: string): string {
  if (!UUID.test(id)) throw new DomainError('not_found', 'Chave não encontrada.')
  return id
}

export async function revokeApiKey(actor: PlatformAdminActor, id: string, now?: Date): Promise<void> {
  exigirAdmin(actor)
  idValido(id)
  const key = orNotFound(await prisma.apiKey.findUnique({ where: { id } }), 'Chave')
  if (key.revokedAt !== null) return
  await prisma.$transaction(async (tx) => {
    const r = await tx.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: agoraDe(now) } })
    if (r.count === 1) await registrar(tx, actor, 'api_key.revoked', key)
  })
}

export async function updateApiKeyOrigins(actor: PlatformAdminActor, id: string, allowedOrigins: string[]): Promise<ApiKeyView> {
  exigirAdmin(actor)
  idValido(id)
  const origens = parse(origensSchema, allowedOrigins)
  const revogada = () => new DomainError('validation', 'Esta chave foi revogada. Crie uma nova chave.')
  const atualizada = await prisma.$transaction(async (tx) => {
    // Trava a linha: o `before` auditado é o valor que esta troca realmente substitui.
    await tx.$queryRaw`SELECT id FROM api_keys WHERE id = ${id}::uuid FOR UPDATE`
    const atual = orNotFound(await tx.apiKey.findUnique({ where: { id } }), 'Chave')
    if (atual.revokedAt !== null) throw revogada()
    const r = await tx.apiKey.updateMany({ where: { id, revokedAt: null }, data: { allowedOrigins: origens } })
    if (r.count !== 1) throw revogada()
    const k = await tx.apiKey.findUniqueOrThrow({ where: { id } })
    await registrar(tx, actor, 'api_key.origins_updated', k, { before: atual.allowedOrigins, after: origens })
    return k
  })
  return paraView(atualizada)
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const NAO_AUTORIZADA = (): ApiAuthError =>
  new ApiAuthError('unauthorized', 'invalid_app_key', 'Chave do aplicativo inválida. Confira a chave configurada no app.')

/** Resolve a chave de app (e a conta) de uma requisição. Chave inválida de qualquer tipo dá a mesma resposta. */
export async function resolveAppKey(i: {
  key: string | null
  businessSlug: string | null
  /** Relógio para teste. */
  now?: Date
}): Promise<ResolvedKey> {
  const slug = i.businessSlug?.trim().toLowerCase() || null
  const m = i.key === null ? null : FORMATO_CHAVE.exec(i.key)
  if (i.key === null || !m) throw NAO_AUTORIZADA()
  const achada = await prisma.apiKey.findUnique({ where: { prefix: m[2] }, include: { business: true } })
  const confere = iguais(hashToken(i.key), achada?.keyHash ?? HASH_FALSO)
  if (!achada || !confere || achada.revokedAt !== null) throw NAO_AUTORIZADA()

  let negocio = achada.business
  if (achada.kind === 'ACCOUNT') {
    if (slug !== null && negocio && slug !== negocio.slug) {
      throw new ApiAuthError('forbidden', 'business_mismatch', 'Esta chave não vale para esta conta. Use a chave da conta certa.')
    }
  } else {
    negocio = slug === null ? null : await prisma.business.findUnique({ where: { slug } })
    if (!negocio) {
      throw new ApiAuthError('unauthorized', 'unknown_business', 'Conta não encontrada. Confira o endereço da conta.')
    }
  }
  if (!negocio) throw NAO_AUTORIZADA()
  if (negocio.status !== 'ACTIVE') {
    throw new ApiAuthError('business_unavailable', 'business_unavailable', 'Esta conta não está disponível agora. Fale com o suporte.')
  }

  // Uma instrução condicional: no máximo uma gravação por minuto por chave, sem ler antes.
  const agora = agoraDe(i.now)
  await prisma.apiKey.updateMany({
    where: { id: achada.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: addMinutes(agora, -INTERVALO_USO_MIN) } }] },
    data: { lastUsedAt: agora },
  })

  return {
    apiKeyId: achada.id,
    kind: achada.kind,
    businessId: negocio.id,
    businessSlug: negocio.slug,
    timeZone: negocio.timezone,
    allowedOrigins: achada.allowedOrigins,
  }
}
