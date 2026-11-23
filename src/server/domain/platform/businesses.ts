import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { areaLink } from '@/server/area-links'
import { issueInvite, INVITE_TTL_DAYS } from '@/server/auth/invites'
import { requireActiveAdmin } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import { Prisma } from '@/server/db/generated/client'
import type { BusinessStatus } from '@/server/db/generated/client'
import { normalizeEmail, normalizePhone, searchKey } from '@/server/domain/customers/contact'
import { DomainError, isUniqueViolation, orNotFound, parse, z, zodFields } from '@/server/domain/errors'
import { getEmailChannel } from '@/server/notifications/channels'
import { isSafeRecipient, maskEmail } from '@/server/notifications/channels/types'
import { renderAccessGranted, renderOwnerInvite } from '@/server/notifications/render-invite'
import type { Modules } from '@/shared/modules'
import { fromIsoInstant, toIsoInstant } from '@/server/time'

export type { BusinessStatus }

type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>


export type BusinessRow = {
  id: string
  slug: string
  name: string
  status: BusinessStatus
  createdAt: Date
  ownerName: string | null
  entryUrl: string
}

export type BusinessDetail = BusinessRow & {
  version: number
  document: string | null
  contactEmail: string | null
  contactPhone: string | null
  timeZone: string
  modules: Modules
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/
const SLUGS_RESERVADOS: readonly string[] = [
  'entrar',
  'sair',
  'api',
  'dev',
  'painel',
  'arquivos',
  'suporte',
  'definir-senha',
  'escolher-conta',
  'admin',
  'www',
]
/** Toda conta usa este fuso (fixo); a coluna `businesses.timezone` continua sendo lida pela agenda. */
const FUSO_PADRAO = 'America/Sao_Paulo'
const LIMITE_PADRAO = 50
const LIMITE_MAXIMO = 100
const MSG_SLUG = 'Use de 3 a 40 letras minúsculas, números ou hífens, sem hífen no começo nem no fim.'

/** Validação do identificador (slug) da conta: a mesma que a tela de cadastro usa para avisar antes de enviar. */
export const slugSchema = z
  .string()
  .min(3, MSG_SLUG)
  .max(40, MSG_SLUG)
  .regex(SLUG, MSG_SLUG)
  .refine((s) => !SLUGS_RESERVADOS.includes(s), 'Este identificador é reservado pelo sistema. Escolha outro.')

function normalizarDocumento(v: string): string {
  return v.replace(/[.\-/\s]/g, '').toUpperCase()
}

function digitoVerificador(valores: number[], pesos: number[]): number {
  const soma = valores.reduce((acc, d, i) => acc + d * (pesos[i] ?? 0), 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

/**
 * CPF (11 dígitos) ou CNPJ (14 posições) com os dígitos verificadores conferidos. O CNPJ aceita o formato alfanumérico
 * da Receita Federal: 12 primeiras posições em `[0-9A-Z]`, valor de cada caractere = código ASCII menos 48.
 */
function documentoValido(d: string): boolean {
  if (/^(.)\1+$/.test(d)) return false
  if (/^\d{11}$/.test(d)) {
    const n = [...d].map(Number)
    const p1 = [10, 9, 8, 7, 6, 5, 4, 3, 2]
    const v1 = digitoVerificador(n.slice(0, 9), p1)
    const v2 = digitoVerificador([...n.slice(0, 9), v1], [11, ...p1])
    return n[9] === v1 && n[10] === v2
  }
  if (/^[0-9A-Z]{12}\d{2}$/.test(d)) {
    const n = [...d].map((c) => c.charCodeAt(0) - 48)
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const v1 = digitoVerificador(n.slice(0, 12), p1)
    const v2 = digitoVerificador([...n.slice(0, 12), v1], [6, ...p1])
    return n[12] === v1 && n[13] === v2
  }
  return false
}

const documentoSchema = z
  .string()
  .transform((v, ctx) => {
    const d = normalizarDocumento(v)
    if (d === '') return null
    if (!documentoValido(d)) {
      ctx.addIssue({ code: 'custom', message: 'Informe um CPF ou CNPJ válido.' })
      return z.NEVER
    }
    return d
  })

const emailOpcional = z
  .string()
  .transform((v, ctx) => {
    if (v.trim() === '') return null
    try {
      return normalizeEmail(v)
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: e instanceof RangeError ? e.message : 'Informe um e-mail válido.' })
      return z.NEVER
    }
  })

const telefoneOpcional = z
  .string()
  .transform((v, ctx) => {
    if (v.trim() === '') return null
    try {
      return normalizePhone(v)
    } catch (e) {
      ctx.addIssue({ code: 'custom', message: e instanceof RangeError ? e.message : 'Informe um telefone válido.' })
      return z.NEVER
    }
  })

const nomeSchema = z.string().trim().min(1, 'Informe o nome da conta.').max(120, 'Use no máximo 120 caracteres.')

const camposOpcionais = {
  document: documentoSchema.nullable().optional(),
  contactEmail: emailOpcional.nullable().optional(),
  contactPhone: telefoneOpcional.nullable().optional(),
}

const criarSchema = z.object({
  name: nomeSchema,
  slug: slugSchema,
  ...camposOpcionais,
  owner: z.object({
    name: nomeSchema,
    email: z.string().transform((v, ctx) => {
      try {
        return normalizeEmail(v)
      } catch (e) {
        ctx.addIssue({ code: 'custom', message: e instanceof RangeError ? e.message : 'Informe um e-mail válido.' })
        return z.NEVER
      }
    }),
  }),
})

/**
 * Pré-validação da conta nova (dados e dono) com o MESMO esquema de `createBusiness`: devolve campo → mensagem, vazio se
 * está tudo certo. Os campos do dono vêm como `owner.name` e `owner.email`. Não grava nada.
 */
export function validateNewBusiness(input: Parameters<typeof createBusiness>[1]): Record<string, string> {
  const r = criarSchema.safeParse(input)
  return r.success ? {} : zodFields(r.error)
}

const editarSchema = z.strictObject({
  name: nomeSchema.optional(),
  slug: slugSchema.optional(),
  ...camposOpcionais,
})

const versaoSchema = z.number().int().min(1)
const confirmarSchema = z.object({ confirmName: z.string() })

function exigirAdmin(actor: PlatformAdminActor): void {
  if (actor?.kind !== 'platform_admin') throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

function idValido(id: string): string {
  if (!UUID.test(id)) throw new DomainError('not_found', 'Conta não encontrada.')
  return id
}

const entryUrlOf = (slug: string): string => areaLink('painel', `/entrar/${slug}`)

const SELECAO_LINHA = {
  id: true,
  slug: true,
  name: true,
  status: true,
  createdAt: true,
  memberships: {
    where: { role: 'OWNER', active: true },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { user: { select: { name: true } } },
  },
} satisfies Prisma.BusinessSelect

type LinhaBruta = Prisma.BusinessGetPayload<{ select: typeof SELECAO_LINHA }>

function paraLinha(b: LinhaBruta): BusinessRow {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    status: b.status,
    createdAt: b.createdAt,
    ownerName: b.memberships[0]?.user.name ?? null,
    entryUrl: entryUrlOf(b.slug),
  }
}

const SELECAO_DETALHE = {
  ...SELECAO_LINHA,
  version: true,
  document: true,
  email: true,
  phone: true,
  timezone: true,
  modules: { select: { loyalty: true, banners: true, store: true, vouchers: true } },
} satisfies Prisma.BusinessSelect

type DetalheBruto = Prisma.BusinessGetPayload<{ select: typeof SELECAO_DETALHE }>

function paraDetalhe(b: DetalheBruto): BusinessDetail {
  return {
    ...paraLinha(b),
    version: b.version,
    document: b.document,
    contactEmail: b.email,
    contactPhone: b.phone,
    timeZone: b.timezone,
    modules: b.modules ?? { loyalty: false, banners: false, store: false, vouchers: false },
  }
}

async function lerDetalhe(id: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<BusinessDetail> {
  const b = orNotFound(await db.business.findUnique({ where: { id }, select: SELECAO_DETALHE }), 'Conta')
  return paraDetalhe(b)
}

function auditar(
  tx: Prisma.TransactionClient,
  actor: PlatformAdminActor,
  action: string,
  businessId: string,
  metadata: Prisma.InputJsonObject,
) {
  return tx.auditLog.create({
    data: {
      businessId,
      actorType: 'PLATFORM_ADMIN',
      actorId: actor.adminId,
      actorName: actor.name,
      onBehalf: false,
      action,
      targetType: 'business',
      targetId: businessId,
      metadata,
    },
  })
}

function slugEmUso(): DomainError {
  const msg = 'Já existe uma conta com este identificador. Escolha outro.'
  return new DomainError('validation', msg, { fields: { slug: msg } })
}

function lerCursor(cursor: string): { at: string; id: string } {
  try {
    const [at, id, resto] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
    if (at !== undefined && id !== undefined && resto === undefined && UUID.test(id) && toIsoInstant(fromIsoInstant(at)) === at) {
      return { at, id }
    }
  } catch {
    // cai no erro abaixo
  }
  throw new DomainError('validation', 'A página pedida não existe mais. Volte ao começo da lista.', {
    fields: { cursor: 'Cursor inválido.' },
  })
}

const escreverCursor = (b: { createdAt: Date; id: string }): string =>
  Buffer.from(`${toIsoInstant(b.createdAt)}|${b.id}`, 'utf8').toString('base64url')

const BUSCA_MAXIMA = 100

function normalizarBusca(texto: string): string {
  return texto.replace(/\p{C}/gu, '').slice(0, BUSCA_MAXIMA)
}

/**
 * Contas da plataforma, da mais nova para a mais antiga, com cursor estável (data de criação e id). A busca olha nome,
 * identificador e nome e e-mail dos donos, sem diferenciar maiúsculas nem acentos (colunas `search_name`, como nos clientes).
 */
export async function listBusinesses(
  actor: PlatformAdminActor,
  q: { search?: string; status?: BusinessStatus; cursor?: string; limit?: number } = {},
): Promise<{ items: BusinessRow[]; nextCursor: string | null }> {
  exigirAdmin(actor)
  const limite = Math.min(Math.max(Math.trunc(q.limit ?? LIMITE_PADRAO), 1), LIMITE_MAXIMO)
  // A busca vem de um campo de texto: sem caracteres de controle (o Postgres recusa NUL) e com no máximo 100 caracteres.
  const termo = searchKey(normalizarBusca(q.search ?? ''))
  const filtros: Prisma.Sql[] = []
  if (q.status !== undefined) filtros.push(Prisma.sql`b.status = ${q.status}::"business_status"`)
  if (termo !== '') {
    filtros.push(Prisma.sql`(
      strpos(b.search_name, ${termo}) > 0
      OR strpos(b.slug, ${termo}) > 0
      OR EXISTS (
        SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.business_id = b.id AND m.role = 'OWNER' AND m.active
          AND (strpos(u.search_name, ${termo}) > 0 OR strpos(lower(u.email), ${termo}) > 0)
      )
    )`)
  }
  if (q.cursor !== undefined) {
    const c = lerCursor(q.cursor)
    filtros.push(Prisma.sql`(b.created_at, b.id) < (${c.at}::timestamptz, ${c.id}::uuid)`)
  }
  const onde = filtros.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filtros, ' AND ')}` : Prisma.empty
  const achadas = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT b.id FROM businesses b ${onde} ORDER BY b.created_at DESC, b.id DESC LIMIT ${limite + 1}`,
  )
  const ids = achadas.map((r) => r.id)
  const linhas = await prisma.business.findMany({ where: { id: { in: ids } }, select: SELECAO_LINHA })
  const porId = new Map(linhas.map((l) => [l.id, l]))
  const ordenadas = ids.flatMap((id) => porId.get(id) ?? [])
  const pagina = ordenadas.slice(0, limite)
  const ultima = pagina[pagina.length - 1]
  return {
    items: pagina.map(paraLinha),
    nextCursor: ordenadas.length > limite && ultima ? escreverCursor(ultima) : null,
  }
}

/** Nome de cada conta pedida (id → nome), numa consulta só. Id que não é UUID ou não existe fica de fora. */
export async function getBusinessNames(actor: PlatformAdminActor, ids: string[]): Promise<Map<string, string>> {
  exigirAdmin(actor)
  const validos = [...new Set(ids.filter((id) => UUID.test(id)))]
  if (validos.length === 0) return new Map()
  const linhas = await prisma.business.findMany({ where: { id: { in: validos } }, select: { id: true, name: true } })
  return new Map(linhas.map((l) => [l.id, l.name]))
}

/** Conta pelo identificador (slug, sem diferenciar maiúsculas) ou pelo id; `null` se não existe. Sem teto de lista. */
export async function findBusinessByRef(actor: PlatformAdminActor, ref: string): Promise<{ id: string; name: string; slug: string } | null> {
  exigirAdmin(actor)
  const texto = normalizarBusca(ref).trim()
  if (texto === '') return null
  const select = { id: true, name: true, slug: true } as const
  if (UUID.test(texto)) return prisma.business.findUnique({ where: { id: texto }, select })
  return prisma.business.findUnique({ where: { slug: texto.toLowerCase() }, select })
}

export async function getBusinessDetail(actor: PlatformAdminActor, id: string): Promise<BusinessDetail> {
  exigirAdmin(actor)
  return lerDetalhe(idValido(id))
}

type OwnerMail = { to: string; ownerName: string; businessName: string; slug: string; token: string | null }

/** Envia o e-mail do dono depois do commit. Falha ou falta de canal não desfaz nada: o retorno diz se saiu. */
async function enviarEmailDoDono(m: OwnerMail): Promise<boolean> {
  const channel = getEmailChannel()
  if (!channel || !isSafeRecipient(m.to)) {
    console.warn(JSON.stringify({ level: 'warn', event: 'owner_mail_skipped', to: maskEmail(m.to) }))
    return false
  }
  try {
    const mail =
      m.token === null
        ? renderAccessGranted({ ownerName: m.ownerName, businessName: m.businessName, entryLink: entryUrlOf(m.slug) })
        : renderOwnerInvite({
            ownerName: m.ownerName,
            businessName: m.businessName,
            link: areaLink('painel', `/definir-senha/${m.token}`),
            ttlDays: INVITE_TTL_DAYS,
          })
    await channel.send({ to: m.to, fromName: 'Agenda Flui', ...mail })
    return true
  } catch (err) {
    // Só o nome do erro: a mensagem do provedor pode trazer o endereço e o corpo (com o link do convite).
    console.error(
      JSON.stringify({ level: 'error', event: 'owner_mail_failed', to: maskEmail(m.to), error: err instanceof Error ? err.name : 'unknown' }),
    )
    return false
  }
}

class DonoCriadoPorOutro extends Error {}

/**
 * Cria a conta (ativa, com marca, módulos e regras padrão) e o dono, tudo numa transação. Dono com e-mail já cadastrado:
 * só o vínculo, sem mexer na senha. Senão cria o usuário sem senha e emite o convite. O e-mail sai depois do commit.
 */
export async function createBusiness(
  actor: PlatformAdminActor,
  input: {
    name: string
    slug: string
    document?: string
    contactEmail?: string
    contactPhone?: string
    owner: { name: string; email: string }
  },
  now: Date = new Date(),
): Promise<{ business: BusinessDetail; owner: { userId: string; existing: boolean }; emailSent: boolean }> {
  exigirAdmin(actor)
  const i = parse(criarSchema, input)
  for (let tentativa = 1; ; tentativa++) {
    try {
      const feito = await prisma.$transaction(async (tx) => {
        await requireActiveAdmin(tx, actor)
        let conta: { id: string }
        try {
          conta = await tx.business.create({
            data: {
              slug: i.slug,
              name: i.name,
              searchName: searchKey(i.name),
              timezone: FUSO_PADRAO,
              document: i.document ?? null,
              email: i.contactEmail ?? null,
              phone: i.contactPhone ?? null,
              branding: { create: { displayName: i.name } },
              modules: { create: {} },
              settings: { create: {} },
            },
            select: { id: true },
          })
        } catch (err) {
          if (isUniqueViolation(err)) throw slugEmUso()
          throw err
        }
        let usuario = await tx.user.findUnique({ where: { email: i.owner.email }, select: { id: true, name: true } })
        const existente = usuario !== null
        const semSenha = usuario === null || (await tx.user.findUniqueOrThrow({ where: { id: usuario.id }, select: { passwordHash: true } })).passwordHash === null
        if (usuario === null) {
          try {
            usuario = await tx.user.create({ data: { name: i.owner.name, searchName: searchKey(i.owner.name), email: i.owner.email }, select: { id: true, name: true } })
          } catch (err) {
            if (isUniqueViolation(err)) throw new DonoCriadoPorOutro()
            throw err
          }
        }
        await tx.membership.create({ data: { businessId: conta.id, userId: usuario.id, role: 'OWNER' } })
        const convite = !semSenha ? null : await issueInvite(tx, usuario.id, now)
        await auditar(tx, actor, 'business.created', conta.id, {
          slug: i.slug,
          ownerUserId: usuario.id,
          ownerExisting: existente,
        })
        return { businessId: conta.id, userId: usuario.id, ownerName: usuario.name, existing: existente, token: convite?.token ?? null }
      })
      const business = await lerDetalhe(feito.businessId)
      const emailSent = await enviarEmailDoDono({
        to: i.owner.email,
        ownerName: feito.ownerName,
        businessName: business.name,
        slug: business.slug,
        token: feito.token,
      })
      return { business, owner: { userId: feito.userId, existing: feito.existing }, emailSent }
    } catch (err) {
      // Outro cadastro criou o mesmo usuário no meio do caminho: uma nova tentativa o encontra e só cria o vínculo.
      if (err instanceof DonoCriadoPorOutro && tentativa < 2) continue
      if (err instanceof DonoCriadoPorOutro) {
        throw new DomainError('conflict', 'O e-mail do dono acabou de ser cadastrado por outra pessoa. Tente de novo.')
      }
      throw err
    }
  }
}

/**
 * Edita os dados da conta. O UPDATE é uma instrução só, condicionada à versão lida: quem grava sobre uma versão antiga
 * recebe `conflict` (`stale_version`) em vez de sobrescrever. Trocar o slug troca o link de entrada (no retorno).
 */
export async function updateBusinessData(
  actor: PlatformAdminActor,
  id: string,
  version: number,
  patch: Partial<{
    name: string
    slug: string
    document: string | null
    contactEmail: string | null
    contactPhone: string | null
  }>,
): Promise<BusinessDetail> {
  exigirAdmin(actor)
  idValido(id)
  const v = parse(versaoSchema, version)
  const p = parse(editarSchema, patch)
  const dados: Prisma.BusinessUncheckedUpdateManyInput = {}
  if (p.name !== undefined) {
    dados.name = p.name
    dados.searchName = searchKey(p.name)
  }
  if (p.slug !== undefined) dados.slug = p.slug
  if (p.document !== undefined) dados.document = p.document
  if (p.contactEmail !== undefined) dados.email = p.contactEmail
  if (p.contactPhone !== undefined) dados.phone = p.contactPhone
  const campos = Object.keys(p).filter((k) => (p as Record<string, unknown>)[k] !== undefined).sort()
  const stale = () =>
    new DomainError('conflict', 'Outra pessoa alterou esta conta enquanto você editava. Recarregue a página e refaça a alteração.', {
      reason: 'stale_version',
    })
  if (campos.length === 0) {
    const atual = await lerDetalhe(id)
    if (atual.version !== v) throw stale()
    return atual
  }
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    let r: { count: number }
    try {
      r = await tx.business.updateMany({ where: { id, version: v }, data: { ...dados, version: { increment: 1 } } })
    } catch (err) {
      if (isUniqueViolation(err)) throw slugEmUso()
      throw err
    }
    if (r.count === 0) {
      orNotFound(await tx.business.findUnique({ where: { id }, select: { id: true } }), 'Conta')
      throw stale()
    }
    await auditar(tx, actor, 'business.updated', id, { fields: campos })
  })
  return lerDetalhe(id)
}

const TRANSICOES: Record<BusinessStatus, readonly BusinessStatus[]> = {
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: ['ACTIVE'],
}

/**
 * Muda a situação da conta. Pede o nome da conta como confirmação. Ao sair de `ACTIVE` e em toda ida para `ARCHIVED`, revoga toda sessão que tem esta conta
 * ativa (a sessão guarda a conta; inclui a de suporte, que não tem usuário); os tokens do app caem sozinhos porque o contexto relê a conta.
 */
export async function setBusinessStatus(
  actor: PlatformAdminActor,
  id: string,
  to: BusinessStatus,
  i: { confirmName: string },
  now: Date = new Date(),
): Promise<BusinessDetail> {
  exigirAdmin(actor)
  idValido(id)
  const { confirmName } = parse(confirmarSchema, i)
  const conta = orNotFound(await prisma.business.findUnique({ where: { id }, select: { name: true, status: true } }), 'Conta')
  if (confirmName !== conta.name) {
    const msg = 'Digite o nome da conta exatamente como aparece, para confirmar.'
    throw new DomainError('validation', msg, { fields: { confirmName: msg } })
  }
  const from = conta.status
  const invalida = () =>
    new DomainError('conflict', 'Esta mudança de situação não é permitida. Recarregue a página e confira a situação atual da conta.', {
      reason: 'invalid_transition',
    })
  if (!TRANSICOES[from].includes(to)) throw invalida()
  await prisma.$transaction(async (tx) => {
    await requireActiveAdmin(tx, actor)
    const r = await tx.business.updateMany({ where: { id, status: from }, data: { status: to, version: { increment: 1 } } })
    if (r.count !== 1) throw invalida()
    if (from === 'ACTIVE' || to === 'ARCHIVED') {
      await tx.session.updateMany({
        where: { activeBusinessId: id, revokedAt: null },
        data: { revokedAt: now },
      })
    }
    await auditar(tx, actor, 'business.status_changed', id, { from, to })
  })
  return lerDetalhe(id)
}
