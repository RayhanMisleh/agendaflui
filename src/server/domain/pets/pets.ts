import type { TenantContext } from '@/server/auth/actor'
import type { PetCoat, PetSize, PetSpecies, Prisma, PriceVariant } from '@/server/db/generated/client'
import type { TenantClient, TenantTx } from '@/server/db/tenant'
import { audit } from '@/server/domain/audit'
import { enqueueCalendarFor } from '@/server/domain/calendar/queue'
import { searchKey } from '@/server/domain/customers/contact'
import { authorize, DomainError, orNotFound, parse, z } from '@/server/domain/errors'
import { definedOnly } from '@/server/domain/input'
import { requirePetNiche } from '@/server/domain/settings/niche-settings'
import { variantDef, variantOfPet } from '@/server/niches'
import { publicUploadUrl, uploadUrl } from '@/server/storage/images'
import { dbDateToLocal, localToDbDate, todayIn } from '@/server/time'
import { petAgeLabel } from './age'

export type PetView = {
  id: string
  customerId: string
  name: string
  species: PetSpecies
  size: PetSize | null
  variant: PriceVariant
  /** "Cão médio" */
  typeLabel: string
  /** "10 a 25 kg" */
  rangeLabel: string | null
  breed: string | null
  /** 'AAAA-MM' */
  birthMonth: string | null
  ageLabel: string | null
  coat: PetCoat | null
  careNotes: string | null
  photoUrl: string | null
  archived: boolean
  createdAt: Date
}

export type PetInput = {
  name: string
  species: PetSpecies
  size?: PetSize | null
  breed?: string | null
  birthMonth?: string | null
  coat?: PetCoat | null
  careNotes?: string | null
}

export const MAX_ACTIVE_PETS = 20
const MIN_BIRTH_YEAR = 1990
const VALIDATION_MESSAGE = 'Confira os campos informados e tente de novo.'

type PetRow = Prisma.PetGetPayload<{ include: { photo: true } }>
const withPhoto = { photo: true } as const

/** Texto opcional: apara e transforma vazio em `null`. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .transform((texto) => (texto === '' ? null : texto))
    .nullable()
}

const petFields = {
  name: z.string().trim().min(1, 'Informe o nome do pet.').max(40, 'Use até 40 caracteres.'),
  species: z.enum(['DOG', 'CAT'], { error: 'Escolha cão ou gato.' }),
  size: z.enum(['SMALL', 'MEDIUM', 'LARGE', 'GIANT'], { error: 'Escolha o porte.' }).nullable(),
  breed: optionalText(60),
  birthMonth: z
    .string()
    .trim()
    .nullable()
    .transform((v) => (v === '' ? null : v))
    .refine((v) => v === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), 'Informe o mês e o ano, por exemplo 2023-05.'),
  coat: z.enum(['SHORT', 'MEDIUM', 'LONG'], { error: 'Escolha a pelagem.' }).nullable(),
  careNotes: optionalText(1000),
}

const createSchema = z.object({
  name: petFields.name,
  species: petFields.species,
  size: petFields.size.optional(),
  breed: petFields.breed.optional(),
  birthMonth: petFields.birthMonth.optional(),
  coat: petFields.coat.optional(),
  careNotes: petFields.careNotes.optional(),
})
const updateSchema = createSchema.partial()
const idSchema = z.uuid()

function validation(fields: Record<string, string>): DomainError {
  return new DomainError('validation', VALIDATION_MESSAGE, { fields })
}

function notFound(): DomainError {
  return new DomainError('not_found', 'Pet não encontrado.')
}

/** Regras que cruzam campos (porte pela espécie) e o relógio (mês de nascimento). */
function checkFields(ctx: TenantContext, v: { species: PetSpecies; size: PetSize | null; birthMonth: string | null | undefined }): void {
  const fields: Record<string, string> = {}
  if (v.species === 'DOG' && v.size === null) fields['size'] = 'Escolha o porte.'
  if (v.species === 'CAT' && v.size !== null) fields['size'] = 'Gato não tem porte.'
  if (typeof v.birthMonth === 'string') {
    if (Number(v.birthMonth.slice(0, 4)) < MIN_BIRTH_YEAR) fields['birthMonth'] = `Informe um ano a partir de ${MIN_BIRTH_YEAR}.`
    else if (v.birthMonth > todayIn(ctx.timeZone, ctx.clock()).slice(0, 7)) fields['birthMonth'] = 'Informe um mês que já passou.'
  }
  if (Object.keys(fields).length > 0) throw validation(fields)
}

type CreateData = { name: string; species: PetSpecies; size: PetSize | null; breed: string | null; birthMonth: string | null; coat: PetCoat | null; careNotes: string | null }

/** Valida e normaliza a ficha de um pet novo (lança `validation` com os campos). */
export function checkPetInput(ctx: TenantContext, input: PetInput): CreateData {
  const p = parse(createSchema, input)
  const data: CreateData = {
    name: p.name,
    species: p.species,
    size: p.size ?? null,
    breed: p.breed ?? null,
    birthMonth: p.birthMonth ?? null,
    coat: p.coat ?? null,
    careNotes: p.careNotes ?? null,
  }
  checkFields(ctx, data)
  return data
}

function toView(ctx: TenantContext, row: PetRow): PetView {
  const variant = variantOfPet(row)
  const def = variantDef(variant)
  const birthMonth = row.birthMonth === null ? null : dbDateToLocal(row.birthMonth).slice(0, 7)
  return {
    id: row.id,
    customerId: row.customerId,
    name: row.name,
    species: row.species,
    size: row.size,
    variant,
    typeLabel: def.label,
    rangeLabel: def.rangeLabel,
    breed: row.breed,
    birthMonth,
    ageLabel: birthMonth === null ? null : petAgeLabel(birthMonth, todayIn(ctx.timeZone, ctx.clock())),
    coat: row.coat,
    careNotes: row.careNotes,
    photoUrl: ctx.channel === 'app' ? publicUploadUrl(row.photo) : uploadUrl(row.photo),
    archived: row.archivedAt !== null,
    createdAt: row.createdAt,
  }
}

/** Permissão da equipe, antes de ler qualquer coisa; o ator cliente é conferido contra o dono depois (`assertOwner`). */
function authorizeStaff(ctx: TenantContext, write: boolean): void {
  if (ctx.actor.kind !== 'customer') authorize(ctx, write ? 'manage_clients' : 'view_clients')
}

/** Cliente só alcança os próprios pets: o de outro some (`not_found`, nunca `forbidden`). */
function assertOwner(ctx: TenantContext, customerId: string): void {
  if (ctx.actor.kind === 'customer' && ctx.actor.customerId !== customerId) throw notFound()
}

async function loadRow(ctx: TenantContext, db: TenantClient | TenantTx, id: string): Promise<PetRow> {
  if (!idSchema.safeParse(id).success) throw notFound()
  const row = orNotFound(await db.pet.findUnique({ where: { id }, include: withPhoto }), 'Pet')
  assertOwner(ctx, row.customerId)
  return row
}

async function assertCustomerActive(ctx: TenantContext, db: TenantClient | TenantTx, customerId: string): Promise<void> {
  const c = await db.customer.findUnique({ where: { id: customerId }, select: { archivedAt: true, anonymizedAt: true } })
  if (!c) throw new DomainError('not_found', 'Cliente não encontrado.')
  if (c.archivedAt !== null || c.anonymizedAt !== null) {
    if (ctx.actor.kind === 'customer') throw new DomainError('forbidden', 'Seu cadastro não está ativo. Fale com a loja.')
    throw new DomainError('validation', 'Este cliente está arquivado. Restaure antes de adicionar pets.')
  }
}

async function assertRoom(ctx: TenantContext, db: TenantClient | TenantTx, customerId: string): Promise<void> {
  const ativos = await db.pet.count({ where: { customerId, archivedAt: null } })
  if (ativos >= MAX_ACTIVE_PETS) {
    const quem = ctx.actor.kind === 'customer' ? 'Você já tem' : 'Este cliente já tem'
    throw new DomainError('validation', `${quem} ${MAX_ACTIVE_PETS} pets ativos. Arquive algum antes.`)
  }
}

export async function listPets(ctx: TenantContext, customerId: string, o: { includeArchived?: boolean } = {}): Promise<PetView[]> {
  authorizeStaff(ctx, false)
  if (!idSchema.safeParse(customerId).success) throw new DomainError('not_found', 'Cliente não encontrado.')
  if (ctx.actor.kind === 'customer' && ctx.actor.customerId !== customerId) throw new DomainError('not_found', 'Cliente não encontrado.')
  await requirePetNiche(ctx)
  const rows = await ctx.db.pet.findMany({
    where: { customerId, ...(o.includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }, { id: 'asc' }],
    include: withPhoto,
  })
  return rows.map((r) => toView(ctx, r))
}

/** Os pets de quem está no app. */
export async function listMyPets(ctx: TenantContext, o: { includeArchived?: boolean } = {}): Promise<PetView[]> {
  if (ctx.actor.kind !== 'customer') throw new DomainError('forbidden', 'Entre na sua conta para ver seus pets.')
  return listPets(ctx, ctx.actor.customerId, o)
}

/** Pets ativos de vários clientes de uma vez (listas da equipe). */
export async function listPetsByCustomers(ctx: TenantContext, customerIds: string[]): Promise<Map<string, PetView[]>> {
  authorize(ctx, 'view_clients')
  const mapa = new Map<string, PetView[]>()
  const ids = customerIds.filter((id) => idSchema.safeParse(id).success)
  if (ids.length === 0) return mapa
  await requirePetNiche(ctx)
  const rows = await ctx.db.pet.findMany({
    where: { customerId: { in: ids }, archivedAt: null },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    include: withPhoto,
  })
  for (const r of rows) {
    const lista = mapa.get(r.customerId) ?? []
    lista.push(toView(ctx, r))
    mapa.set(r.customerId, lista)
  }
  return mapa
}

export async function getPet(ctx: TenantContext, id: string): Promise<PetView> {
  authorizeStaff(ctx, false)
  await requirePetNiche(ctx)
  return toView(ctx, await loadRow(ctx, ctx.db, id))
}

/** Cria o pet dentro de uma transação já aberta (também usada por `createCustomerWithPet`). */
export async function createPetIn(tx: TenantTx, ctx: TenantContext, customerId: string, input: PetInput): Promise<PetView> {
  authorizeStaff(ctx, true)
  if (!idSchema.safeParse(customerId).success || (ctx.actor.kind === 'customer' && ctx.actor.customerId !== customerId)) {
    throw new DomainError('not_found', 'Cliente não encontrado.')
  }
  await requirePetNiche(ctx, tx)
  const data = checkPetInput(ctx, input)
  await tx.$lockKey('customer', customerId)
  await assertCustomerActive(ctx, tx, customerId)
  await assertRoom(ctx, tx, customerId)
  const row = await tx.pet.create({
    data: {
      businessId: ctx.businessId,
      customerId,
      name: data.name,
      searchName: searchKey(data.name),
      species: data.species,
      size: data.size,
      breed: data.breed,
      birthMonth: data.birthMonth === null ? null : localToDbDate(`${data.birthMonth}-01`),
      coat: data.coat,
      careNotes: data.careNotes,
    },
    include: withPhoto,
  })
  await audit(ctx, { action: 'pet.created', targetType: 'Pet', targetId: row.id, metadata: { customerId } }, tx)
  return toView(ctx, row)
}

export async function createPet(ctx: TenantContext, customerId: string, input: PetInput): Promise<PetView> {
  authorizeStaff(ctx, true)
  return ctx.db.$transaction((tx) => createPetIn(tx, ctx, customerId, input))
}

export async function updatePet(ctx: TenantContext, id: string, input: Partial<PetInput>): Promise<PetView> {
  authorizeStaff(ctx, true)
  await requirePetNiche(ctx)
  const dado = definedOnly(parse(updateSchema, input))
  const atual = await loadRow(ctx, ctx.db, id)
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', atual.customerId)
    const row = await loadRow(ctx, tx, id)
    await assertCustomerActive(ctx, tx, row.customerId)
    if (row.archivedAt !== null) throw new DomainError('conflict', 'Este pet está arquivado. Restaure o pet antes de alterá-lo.')
    const species = dado.species ?? row.species
    // Trocar a espécie sem dizer o porte: gato fica sem porte; cão precisa dizer o porte.
    const size = dado.size !== undefined ? dado.size : species === 'CAT' ? null : row.size
    const birthMonth = dado.birthMonth !== undefined ? dado.birthMonth : undefined
    checkFields(ctx, { species, size, birthMonth })
    const mudancas: Prisma.PetUncheckedUpdateInput = {
      ...(dado.name !== undefined ? { name: dado.name, searchName: searchKey(dado.name) } : {}),
      ...(dado.species !== undefined || dado.size !== undefined ? { species, size } : {}),
      ...(dado.breed !== undefined ? { breed: dado.breed } : {}),
      ...(birthMonth !== undefined ? { birthMonth: birthMonth === null ? null : localToDbDate(`${birthMonth}-01`) } : {}),
      ...(dado.coat !== undefined ? { coat: dado.coat } : {}),
      ...(dado.careNotes !== undefined ? { careNotes: dado.careNotes } : {}),
    }
    const campos = Object.keys(dado)
    if (campos.length === 0) return toView(ctx, row)
    const nova = await tx.pet.update({ where: { id }, data: mudancas, include: withPhoto })
    await audit(ctx, { action: 'pet.updated', targetType: 'Pet', targetId: id, metadata: { fields: campos } }, tx)
    // O título do evento no Google Agenda leva o nome, o animal e o porte do pet.
    if (nova.name !== row.name || nova.species !== row.species || nova.size !== row.size) {
      await enqueueCalendarFor(tx, ctx, { petId: id }, { futureOnly: true })
    }
    return toView(ctx, nova)
  })
}

export async function archivePet(ctx: TenantContext, id: string): Promise<void> {
  authorizeStaff(ctx, true)
  await requirePetNiche(ctx)
  const atual = await loadRow(ctx, ctx.db, id)
  await ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', atual.customerId)
    const row = await loadRow(ctx, tx, id)
    if (row.archivedAt !== null) return
    await tx.pet.update({ where: { id }, data: { archivedAt: ctx.clock() } })
    await audit(ctx, { action: 'pet.archived', targetType: 'Pet', targetId: id }, tx)
  })
}

export async function restorePet(ctx: TenantContext, id: string): Promise<PetView> {
  authorizeStaff(ctx, true)
  await requirePetNiche(ctx)
  const atual = await loadRow(ctx, ctx.db, id)
  return ctx.db.$transaction(async (tx) => {
    await tx.$lockKey('customer', atual.customerId)
    const row = await loadRow(ctx, tx, id)
    if (row.archivedAt === null) return toView(ctx, row)
    await assertCustomerActive(ctx, tx, row.customerId)
    await assertRoom(ctx, tx, row.customerId)
    const nova = await tx.pet.update({ where: { id }, data: { archivedAt: null }, include: withPhoto })
    await audit(ctx, { action: 'pet.restored', targetType: 'Pet', targetId: id }, tx)
    return toView(ctx, nova)
  })
}

/** Na marcação: o pet precisa ser ativo e do cliente do agendamento. */
export async function loadPetForBooking(
  db: TenantClient | TenantTx,
  i: { petId: string; customerId: string },
): Promise<{ id: string; name: string; variant: PriceVariant }> {
  const recusa = () => new DomainError('validation', 'Escolha um pet deste cliente.', { fields: { petId: 'Escolha um pet deste cliente.' } })
  if (!idSchema.safeParse(i.petId).success) throw recusa()
  const pet = await db.pet.findFirst({ where: { id: i.petId, customerId: i.customerId, archivedAt: null } })
  if (!pet) throw recusa()
  return { id: pet.id, name: pet.name, variant: variantOfPet(pet) }
}
