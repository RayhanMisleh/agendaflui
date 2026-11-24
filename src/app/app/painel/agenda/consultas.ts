'use server'
import { requireTenant } from '@/server/auth/guards'
import { can } from '@/server/auth/capabilities'
import type { PetSize, PetSpecies, PriceVariant } from '@/server/db/generated/client'
import { listServicesForPet } from '@/server/domain/catalog/pet-services'
import { createCustomer, createCustomerWithPet, listCustomers } from '@/server/domain/customers/customers'
import { createPet, listPets, listPetsByCustomers } from '@/server/domain/pets/pets'
import type { PetView } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { DomainError } from '@/server/domain/errors'
import { getAvailability } from '@/server/domain/scheduling/availability'
import { effectiveLocalTime, isLocalDate, isLocalTime, toIsoInstant } from '@/server/time'
import { MENSAGEM_GENERICA_NEGOCIO } from '@/app/_lib/form-state'
import { unstable_rethrow } from 'next/navigation'

/*
 * Consultas que a folha de marcar faz enquanto a pessoa escolhe: clientes, horários livres e o cadastro rápido. Leem pelo
 * domínio com a sessão de quem pede; erro esperado volta como mensagem, nunca como exceção para a tela.
 */

type Falha = { ok: false; message: string }
type Pedido<T> = ({ ok: true } & T) | Falha

function falha(err: unknown): Falha {
  unstable_rethrow(err)
  if (err instanceof DomainError) return { ok: false, message: err.message }
  console.error(JSON.stringify({ level: 'error', event: 'agenda_query_failed', error: err instanceof Error ? err.name : 'unknown' }))
  return { ok: false, message: MENSAGEM_GENERICA_NEGOCIO }
}

export type PetResumo = { id: string; name: string; typeLabel: string; variant: PriceVariant }
export type ClienteBusca = { id: string; name: string; phoneLabel: string | null; pets: PetResumo[] }
type PetNovo = { name: string; species: PetSpecies; size: PetSize | null }

const resumoDe = (p: PetView): PetResumo => ({ id: p.id, name: p.name, typeLabel: p.typeLabel, variant: p.variant })

/** Os pets ativos de cada cliente; conta sem nicho não tem pets (nada a consultar). */
async function petsDe(ctx: Awaited<ReturnType<typeof requireTenant>>, ids: string[]): Promise<Map<string, PetView[]>> {
  if ((await getNicheSettings(ctx)).niche === null) return new Map()
  return listPetsByCustomers(ctx, ids)
}

export async function buscarClientes(termo: string): Promise<Pedido<{ clientes: ClienteBusca[] }>> {
  const ctx = await requireTenant()
  try {
    const { items } = await listCustomers(ctx, { search: termo.replace(/\0/g, ''), limit: 8 })
    const pets = await petsDe(ctx, items.map((c) => c.id))
    return { ok: true, clientes: items.map((c) => ({ id: c.id, name: c.name, phoneLabel: c.phoneLabel, pets: (pets.get(c.id) ?? []).map(resumoDe) })) }
  } catch (err) {
    return falha(err)
  }
}

/** Cliente novo só com nome e telefone; em conta pet, com o primeiro pet na mesma gravação (se o pet não passa, o cliente não fica). */
export async function cadastrarClienteRapido(p: { nome: string; telefone: string; pet?: PetNovo }): Promise<Pedido<{ cliente: ClienteBusca }>> {
  const ctx = await requireTenant()
  if (!can(ctx.actor, 'manage_clients')) return { ok: false, message: 'Você não tem permissão para cadastrar clientes. Peça a quem gerencia.' }
  try {
    if (p.pet) {
      const r = await createCustomerWithPet(ctx, { name: p.nome, phone: p.telefone }, { name: p.pet.name, species: p.pet.species, size: p.pet.size })
      return { ok: true, cliente: { id: r.customer.id, name: r.customer.name, phoneLabel: r.customer.phoneLabel, pets: [resumoDe(r.pet)] } }
    }
    const c = await createCustomer(ctx, { name: p.nome, phone: p.telefone })
    return { ok: true, cliente: { id: c.id, name: c.name, phoneLabel: c.phoneLabel, pets: [] } }
  } catch (err) {
    return falha(err)
  }
}

export async function adicionarPetRapido(customerId: string, pet: PetNovo): Promise<Pedido<{ pet: PetResumo }>> {
  const ctx = await requireTenant()
  if (!can(ctx.actor, 'manage_clients')) return { ok: false, message: 'Você não tem permissão para cadastrar pets. Peça a quem gerencia.' }
  try {
    return { ok: true, pet: resumoDe(await createPet(ctx, customerId, { name: pet.name, species: pet.species, size: pet.size })) }
  } catch (err) {
    return falha(err)
  }
}

export async function petsDoCliente(customerId: string): Promise<Pedido<{ pets: PetResumo[] }>> {
  const ctx = await requireTenant()
  try {
    if ((await getNicheSettings(ctx)).niche === null) return { ok: true, pets: [] }
    return { ok: true, pets: (await listPets(ctx, customerId)).map(resumoDe) }
  } catch (err) {
    return falha(err)
  }
}

export type ServicoDoPet = { id: string; name: string; offered: boolean; priceCents: number | null; durationMin: number | null; reason: string | null }

/** Os serviços com preço e tempo do porte do pet; o que a loja não faz para esse animal vem com o motivo. */
export async function servicosDoPet(petId: string): Promise<Pedido<{ servicos: ServicoDoPet[] }>> {
  const ctx = await requireTenant()
  try {
    const lista = await listServicesForPet(ctx, petId)
    return { ok: true, servicos: lista.map((o) => ({ id: o.service.id, name: o.service.name, offered: o.offered, priceCents: o.priceCents, durationMin: o.durationMin, reason: o.reason })) }
  } catch (err) {
    return falha(err)
  }
}

export type HorarioLivre = { iso: string; label: string }

export async function buscarHorarios(pedido: { serviceIds: string[]; date: string; professionalId: string; petId?: string; durationMin?: number }): Promise<Pedido<{ horarios: HorarioLivre[]; durationMin: number }>> {
  const ctx = await requireTenant()
  if (!isLocalDate(pedido.date)) return { ok: false, message: 'Informe uma data válida.' }
  try {
    const r = await getAvailability(ctx, { date: pedido.date, serviceIds: pedido.serviceIds, professionalId: pedido.professionalId === '' ? null : pedido.professionalId, ...(pedido.petId ? { petId: pedido.petId } : {}), ...(pedido.durationMin !== undefined ? { durationMin: pedido.durationMin } : {}) })
    return { ok: true, horarios: r.slots.map((s) => ({ iso: toIsoInstant(s.startsAt), label: s.label })), durationMin: r.durationMin }
  } catch (err) {
    return falha(err)
  }
}

/**
 * O horário local que o servidor vai gravar para dia + hora (hora que não existe no salto do horário de verão avança:
 * 02:30 vira 03:30). A confirmação de remarcar mostra este, para o texto e a gravação usarem a mesma conversão.
 */
export async function horarioEfetivo(date: string, time: string): Promise<string | null> {
  const ctx = await requireTenant()
  if (!isLocalDate(date) || !isLocalTime(time)) return null
  return effectiveLocalTime(date, time, ctx.timeZone)
}
