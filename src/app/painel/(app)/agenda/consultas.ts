'use server'
import { requireTenant } from '@/server/auth/guards'
import { can } from '@/server/auth/capabilities'
import { createCustomer, listCustomers } from '@/server/domain/customers/customers'
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

export type ClienteBusca = { id: string; name: string; phoneLabel: string | null }

export async function buscarClientes(termo: string): Promise<Pedido<{ clientes: ClienteBusca[] }>> {
  const ctx = await requireTenant()
  try {
    const { items } = await listCustomers(ctx, { search: termo.replace(/\0/g, ''), limit: 8 })
    return { ok: true, clientes: items.map((c) => ({ id: c.id, name: c.name, phoneLabel: c.phoneLabel })) }
  } catch (err) {
    return falha(err)
  }
}

export async function cadastrarClienteRapido(nome: string, telefone: string): Promise<Pedido<{ cliente: ClienteBusca }>> {
  const ctx = await requireTenant()
  if (!can(ctx.actor, 'manage_clients')) return { ok: false, message: 'Você não tem permissão para cadastrar clientes. Peça a quem gerencia.' }
  try {
    const c = await createCustomer(ctx, { name: nome, phone: telefone })
    return { ok: true, cliente: { id: c.id, name: c.name, phoneLabel: c.phoneLabel } }
  } catch (err) {
    return falha(err)
  }
}

export type HorarioLivre = { iso: string; label: string }

export async function buscarHorarios(pedido: { serviceIds: string[]; date: string; professionalId: string }): Promise<Pedido<{ horarios: HorarioLivre[]; durationMin: number }>> {
  const ctx = await requireTenant()
  if (!isLocalDate(pedido.date)) return { ok: false, message: 'Informe uma data válida.' }
  try {
    const r = await getAvailability(ctx, { date: pedido.date, serviceIds: pedido.serviceIds, professionalId: pedido.professionalId === '' ? null : pedido.professionalId })
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
