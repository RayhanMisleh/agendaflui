import type { TenantContext } from '@/server/auth/actor'
import { revokeAllFor } from '@/server/auth/api-tokens'
import type { Prisma } from '@/server/db/generated/client'
import { audit } from '@/server/domain/audit'
import { definedOnly, isCustomer } from '@/server/domain/input'
import { authorize, DomainError, isRecordNotFound, orNotFound, parse, z } from '@/server/domain/errors'
import {
  cancelOpenAppointmentsOfCustomer,
  openAppointmentsOfCustomer,
  withCustomerAppointmentsLocked,
} from '@/server/domain/scheduling/customer-appointments'
import { cancelPendingForCustomer } from '@/server/domain/notifications/outbox'
import { formatPhone, normalizeEmail, normalizePhone, searchKey } from '@/server/domain/customers/contact'
import { deleteUploadRecord, publicUploadUrl, removeUploadFile, uploadUrl } from '@/server/storage/images'
import { dbDateToLocal, isLocalDate, localToDbDate, todayIn } from '@/server/time'

export type CustomerView = {
  id: string
  name: string
  email: string | null
  phone: string | null
  phoneLabel: string | null
  avatarUrl: string | null
  birthDate: string | null
  /** Anotação interna da equipe: o cliente do app não recebe este campo (a chave nem existe). */
  notes?: string | null
  isClubMember: boolean
  origin: 'APP' | 'PANEL'
  hasAppAccess: boolean
  archived: boolean
  createdAt: Date
}

export type CustomerInput = {
  name: string
  email?: string | null
  phone?: string | null
  birthDate?: string | null
  notes?: string | null
  isClubMember?: boolean
}

const ANONYMIZED_NAME = 'Cliente removido'
const CANCEL_REASON = 'Cadastro removido a pedido do cliente.'
const REMOVED_MESSAGE = 'Este cadastro foi removido a pedido do cliente e não pode mais ser alterado.'
const MIN_BIRTH_DATE = '1900-01-01'
type CustomerRow = Prisma.CustomerGetPayload<{ include: { avatar: true } }>
const withAvatar = { avatar: true } as const

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

/** Texto opcional: apara e transforma vazio em `null`. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .transform((texto) => (texto === '' ? null : texto))
    .nullable()
}

/** Contato opcional: vazio vira `null`; senão normaliza e devolve a mensagem do `RangeError`. */
function optionalContact(normalize: (input: string) => string) {
  return z
    .string()
    .trim()
    .nullable()
    .transform((valor, ctx) => {
      if (valor === null || valor === '') return null
      try {
        return normalize(valor)
      } catch (err) {
        ctx.issues.push({ code: 'custom', message: err instanceof RangeError ? err.message : 'Valor inválido.', input: valor })
        return z.NEVER
      }
    })
}

const customerFields = {
  name: z.string().trim().min(1, 'Informe o nome do cliente.').max(120, 'Use até 120 caracteres.'),
  email: optionalContact(normalizeEmail),
  phone: optionalContact(normalizePhone),
  birthDate: z
    .string()
    .trim()
    .nullable()
    .transform((valor) => (valor === '' ? null : valor))
    .refine((valor) => valor === null || isLocalDate(valor), 'Informe uma data válida, por exemplo 1990-05-17.')
    .refine((valor) => valor === null || valor >= MIN_BIRTH_DATE, 'Informe uma data de nascimento a partir de 1900.'),
  notes: optionalText(2000),
  isClubMember: z.boolean(),
}

const createSchema = z.object({
  name: customerFields.name,
  email: customerFields.email.optional(),
  phone: customerFields.phone.optional(),
  birthDate: customerFields.birthDate.optional(),
  notes: customerFields.notes.optional(),
  isClubMember: customerFields.isClubMember.optional(),
})

const updateSchema = createSchema.partial()

const idSchema = z.uuid()

const listSchema = z.object({
  // O Postgres não aceita o caractere NUL em texto: ele sai da busca antes de chegar ao banco.
  search: z
    .string()
    .max(80, 'Use até 80 caracteres na busca.')
    .transform((texto) => texto.replace(/\0/g, ''))
    .optional(),
  clubOnly: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
  onlyArchived: z.boolean().optional(),
  cursor: z.string().max(1024).optional(),
  limit: z
    .number()
    .int('Informe o limite como número inteiro.')
    .min(1, 'O limite mínimo é 1.')
    .max(MAX_LIMIT, `O limite máximo é ${MAX_LIMIT}.`)
    .optional(),
})

// O Prisma não escapa os coringas do LIKE; sem isso "%" e "_" casariam com tudo.
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

function toView(ctx: TenantContext, row: CustomerRow): CustomerView {
  const view: CustomerView = {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    phoneLabel: row.phone === null ? null : formatPhone(row.phone),
    avatarUrl: ctx.channel === 'app' ? publicUploadUrl(row.avatar) : uploadUrl(row.avatar),
    birthDate: row.birthDate === null ? null : dbDateToLocal(row.birthDate),
    isClubMember: row.isClubMember,
    origin: row.origin,
    hasAppAccess: row.passwordHash !== null,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt,
  }
  return isCustomer(ctx) ? view : { ...view, notes: row.notes }
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Cliente não encontrado.')
}

function removedConflict(): DomainError {
  return new DomainError('conflict', REMOVED_MESSAGE)
}

function emailTaken(): DomainError {
  return new DomainError('conflict', 'Já existe um cliente com este e-mail. Use outro e-mail ou abra o cadastro existente.', {
    reason: 'email_taken',
    fields: { email: 'Já existe um cliente com este e-mail.' },
  })
}

/** Violação do índice único de e-mail (P2002); outros índices únicos não entram aqui. */
function isEmailUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err) || err.code !== 'P2002') return false
  const meta = 'meta' in err ? JSON.stringify(err.meta) : ''
  return meta.includes('customers_business_id_email_key')
}

function forbidden(message = 'Você não tem permissão para ver este cadastro.'): DomainError {
  return new DomainError('forbidden', message)
}

/** Ator cliente só alcança o próprio cadastro. */
function assertOwnRecord(ctx: TenantContext, id: string): void {
  if (ctx.actor.kind === 'customer' && ctx.actor.customerId !== id) throw forbidden()
}

async function loadRow(ctx: TenantContext, id: string): Promise<CustomerRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  return orNotFound(await ctx.db.customer.findUnique({ where: { id }, include: withAvatar }), 'Cliente')
}

function assertBirthDateNotFuture(ctx: TenantContext, birthDate: string | null | undefined): void {
  if (typeof birthDate === 'string' && birthDate > todayIn(ctx.timeZone, ctx.clock())) {
    throw new DomainError('validation', 'Confira os campos informados e tente de novo.', {
      fields: { birthDate: 'A data de nascimento não pode ser no futuro.' },
    })
  }
}

async function assertEmailFree(ctx: TenantContext, email: string, selfId: string | null): Promise<void> {
  const taken = await ctx.db.customer.findFirst({
    where: { email, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true },
  })
  if (taken) throw emailTaken()
}

type Cursor = { name: string; id: string }

function encodeCursor(row: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.name, row.id])).toString('base64url')
}

function decodeCursor(cursor: string): Cursor {
  const invalid = new DomainError('validation', 'O cursor de paginação é inválido. Recarregue a lista.', {
    fields: { cursor: 'Cursor inválido.' },
  })
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string' &&
      idSchema.safeParse(parsed[1]).success
    ) {
      return { name: parsed[0], id: parsed[1] }
    }
  } catch {
    // cai no erro abaixo
  }
  throw invalid
}

export async function listCustomers(
  ctx: TenantContext,
  q: { search?: string; clubOnly?: boolean; includeArchived?: boolean; onlyArchived?: boolean; cursor?: string; limit?: number } = {},
): Promise<{ items: CustomerView[]; nextCursor: string | null }> {
  authorize(ctx, 'view_clients')
  const { search, clubOnly, includeArchived, onlyArchived, cursor, limit = DEFAULT_LIMIT } = parse(listSchema, q)
  const after = cursor === undefined ? null : decodeCursor(cursor)
  const term = search?.trim() ?? ''
  const key = searchKey(term)
  const digits = term.replace(/\D/g, '')
  const looksLikePhone = /^[\d\s()+.-]+$/.test(term) && digits.length >= 3
  const conditions: Prisma.CustomerWhereInput[] = []
  if (term.length >= 2) {
    conditions.push({
      OR: [
        { searchName: { contains: escapeLike(key) } },
        { email: { contains: escapeLike(term), mode: 'insensitive' } },
        ...(looksLikePhone ? [{ phone: { contains: digits } }] : []),
      ],
    })
  }
  if (after) {
    conditions.push({ OR: [{ name: { gt: after.name } }, { name: after.name, id: { gt: after.id } }] })
  }
  const rows = await ctx.db.customer.findMany({
    where: {
      ...(clubOnly ? { isClubMember: true } : {}),
      // Anonimizado não é "arquivado": o cadastro virou "Cliente removido" e não volta.
      ...(onlyArchived ? { archivedAt: { not: null }, anonymizedAt: null } : includeArchived ? {} : { archivedAt: null }),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: withAvatar,
    take: limit + 1,
  })
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map((row) => toView(ctx, row)),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  }
}

/** O cadastro foi anonimizado a pedido (dados apagados, sem volta)? Fica fora de `CustomerView` para não mudar o contrato da API. */
export async function isCustomerAnonymized(ctx: TenantContext, id: string): Promise<boolean> {
  authorize(ctx, 'view_clients')
  if (!idSchema.safeParse(id).success) throw notFound()
  const row = orNotFound(await ctx.db.customer.findUnique({ where: { id }, select: { anonymizedAt: true } }), 'Cliente')
  return row.anonymizedAt !== null
}

export async function getCustomer(ctx: TenantContext, id: string): Promise<CustomerView> {
  if (ctx.actor.kind === 'customer') assertOwnRecord(ctx, id)
  else authorize(ctx, 'view_clients')
  return toView(ctx, await loadRow(ctx, id))
}

export async function createCustomer(ctx: TenantContext, input: CustomerInput): Promise<CustomerView> {
  authorize(ctx, 'manage_clients')
  const { name, birthDate, ...optional } = parse(createSchema, input)
  assertBirthDateNotFuture(ctx, birthDate)
  const data = {
    name,
    searchName: searchKey(name),
    ...definedOnly(optional),
    ...(birthDate ? { birthDate: localToDbDate(birthDate) } : {}),
  }
  if (data.email) await assertEmailFree(ctx, data.email, null)
  try {
    const created = await ctx.db.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { ...data, businessId: ctx.businessId, origin: 'PANEL' },
        include: withAvatar,
      })
      await audit(ctx, { action: 'customer.created', targetType: 'Customer', targetId: customer.id }, tx)
      return customer
    })
    return toView(ctx, created)
  } catch (err) {
    if (isEmailUniqueViolation(err)) throw emailTaken()
    throw err
  }
}

export async function updateCustomer(
  ctx: TenantContext,
  id: string,
  input: Partial<CustomerInput>,
): Promise<CustomerView> {
  const customer = ctx.actor.kind === 'customer'
  if (customer) assertOwnRecord(ctx, id)
  else authorize(ctx, 'manage_clients')
  if (customer && (input.notes !== undefined || input.isClubMember !== undefined)) {
    throw forbidden('Você não pode alterar este dado do cadastro.')
  }
  const { birthDate, ...rest } = definedOnly(parse(updateSchema, input))
  assertBirthDateNotFuture(ctx, birthDate)
  const current = await loadRow(ctx, id)
  if (current.anonymizedAt !== null) throw removedConflict()
  if (current.archivedAt !== null) {
    throw new DomainError('conflict', 'Este cliente está arquivado. Restaure o cadastro antes de alterá-lo.')
  }
  const changes = {
    ...rest,
    ...(birthDate !== undefined ? { birthDate: birthDate === null ? null : localToDbDate(birthDate) } : {}),
  }
  const fields = Object.keys(changes)
  if (fields.length === 0) return toView(ctx, current)
  const data: Prisma.CustomerUncheckedUpdateInput = {
    ...changes,
    ...(changes.name !== undefined ? { searchName: searchKey(changes.name) } : {}),
    // E-mail novo (ou removido) deixa de estar verificado.
    ...(changes.email !== undefined && changes.email !== current.email ? { emailVerifiedAt: null } : {}),
  }
  if (changes.email) await assertEmailFree(ctx, changes.email, id)
  try {
    const updated = await ctx.db.$transaction(async (tx) => {
      const row = await tx.customer.update({ where: { id }, data, include: withAvatar })
      await audit(
        ctx,
        { action: 'customer.updated', targetType: 'Customer', targetId: id, metadata: { fields } },
        tx,
      )
      return row
    })
    return toView(ctx, updated)
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    if (isEmailUniqueViolation(err)) throw emailTaken()
    throw err
  }
}

export async function archiveCustomer(ctx: TenantContext, id: string): Promise<void> {
  authorize(ctx, 'manage_clients')
  const current = await loadRow(ctx, id)
  if (current.archivedAt !== null) return
  try {
    await ctx.db.$transaction(async (tx) => {
      // A trava do cliente serializa com as marcações dele; atendimento em andamento também impede.
      await tx.$lockKey('customer', id)
      // Relê sob a trava: outra chamada pode ter arquivado entre a leitura de fora e a trava.
      const locked = await tx.customer.findUnique({ where: { id }, select: { archivedAt: true } })
      if (!locked) throw notFound()
      if (locked.archivedAt !== null) return
      const count = (await openAppointmentsOfCustomer(ctx, tx, id)).length
      if (count > 0) {
        const quantos = count === 1 ? 'Há 1 agendamento futuro' : `Há ${count} agendamentos futuros`
        throw new DomainError(
          'conflict',
          `${quantos} com este cliente. Cancele os agendamentos antes de arquivar o cadastro.`,
          { reason: 'has_future_appointments', details: { count } },
        )
      }
      const now = ctx.clock()
      await tx.customer.update({ where: { id }, data: { archivedAt: now } })
      // Cliente arquivado não renova a sessão do app (a trava do cliente já está nesta transação).
      await revokeAllFor(tx, { customerId: id }, now)
      await cancelPendingForCustomer(tx, id)
      await audit(ctx, { action: 'customer.archived', targetType: 'Customer', targetId: id }, tx)
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

export async function restoreCustomer(ctx: TenantContext, id: string): Promise<CustomerView> {
  authorize(ctx, 'manage_clients')
  const current = await loadRow(ctx, id)
  if (current.anonymizedAt !== null) throw removedConflict()
  if (current.archivedAt === null) return toView(ctx, current)
  try {
    const restored = await ctx.db.$transaction(async (tx) => {
      const row = await tx.customer.update({ where: { id }, data: { archivedAt: null }, include: withAvatar })
      await audit(ctx, { action: 'customer.restored', targetType: 'Customer', targetId: id }, tx)
      return row
    })
    return toView(ctx, restored)
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
}

/**
 * Remove os dados pessoais e mantém o cadastro vazio, para os agendamentos continuarem ligados. Os
 * agendamentos futuros são cancelados na mesma transação (sem aviso ao cliente, que está saindo).
 */
export async function anonymizeCustomer(ctx: TenantContext, id: string): Promise<void> {
  if (ctx.actor.kind === 'customer') assertOwnRecord(ctx, id)
  else authorize(ctx, 'manage_clients')
  await loadRow(ctx, id)
  const now = ctx.clock()
  let avatarPath: string | null = null
  try {
    await withCustomerAppointmentsLocked(ctx, id, async (tx, open) => {
      // Relê sob a trava: outra chamada pode ter anonimizado entre a leitura de fora e a trava.
      const current = await tx.customer.findUnique({ where: { id } })
      if (!current) throw notFound()
      if (current.anonymizedAt !== null) return
      await tx.customer.update({
        where: { id },
        data: {
          name: ANONYMIZED_NAME,
          searchName: searchKey(ANONYMIZED_NAME),
          email: null,
          phone: null,
          passwordHash: null,
          emailVerifiedAt: null,
          avatarUploadId: null,
          birthDate: null,
          notes: null,
          anonymizedAt: now,
          archivedAt: current.archivedAt ?? now,
        },
      })
      // A observação do cliente é texto livre e pode ter dado pessoal: sai de todos os agendamentos dele.
      await tx.appointment.updateMany({ where: { customerId: id, customerNote: { not: null } }, data: { customerNote: null } })
      // Endereços de entrega são dado pessoal: saem todos, e a cópia do endereço e a observação gravadas nos pedidos também
      // (os itens, os valores e o serviço de frete ficam: são o registro da venda).
      await tx.address.deleteMany({ where: { customerId: id } })
      await tx.order.updateMany({
        where: { customerId: id },
        data: { shipRecipient: null, shipPostalCode: null, shipStreet: null, shipNumber: null, shipComplement: null, shipDistrict: null, shipCity: null, shipState: null, customerNote: null },
      })
      // Cancela depois de anonimizar: o cliente já não recebe aviso nenhum.
      const canceled = await cancelOpenAppointmentsOfCustomer(tx, ctx, open, CANCEL_REASON)
      await cancelPendingForCustomer(tx, id)
      // Sessões, dispositivos e códigos de verificação (guardados pelo e-mail) do cliente saem junto.
      await tx.refreshToken.deleteMany({ where: { customerId: id } })
      await tx.device.deleteMany({ where: { customerId: id } })
      if (current.email !== null) await tx.verificationCode.deleteMany({ where: { email: current.email } })
      if (current.avatarUploadId !== null) avatarPath = await deleteUploadRecord(tx, current.avatarUploadId)
      await audit(
        ctx,
        {
          action: 'customer.anonymized',
          targetType: 'Customer',
          targetId: id,
          metadata: { hadAvatar: current.avatarUploadId !== null, canceledAppointments: canceled },
        },
        tx,
      )
    })
  } catch (err) {
    if (isRecordNotFound(err)) throw notFound()
    throw err
  }
  // O arquivo só sai depois do commit, em melhor esforço; se falhar, a auditoria registra e nada é lançado.
  if (avatarPath !== null && !(await removeUploadFile(avatarPath)).fileRemoved) {
    await audit(ctx, { action: 'customer.avatar_file_orphaned', targetType: 'Customer', targetId: id })
  }
}
