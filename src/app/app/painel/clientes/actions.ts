'use server'
import { redirect } from 'next/navigation'
import {
  anonymizeCustomer,
  archiveCustomer,
  createCustomer,
  getCustomer,
  restoreCustomer,
  updateCustomer,
} from '@/server/domain/customers/customers'
import type { CustomerInput } from '@/server/domain/customers/customers'
import { erroDeCampo, feito, ler } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'

/*
 * Ações da tela de clientes. Escrever pede `manage_clients`: o profissional só lê. O `id` vem em campo escondido e o
 * domínio só o encontra dentro da conta ativa. O campo `loyalty` marca que o módulo de fidelidade está ligado (sem ele o
 * "do clube" não muda).
 */

const DADOS = ['id', 'name', 'email', 'phone', 'birthDate', 'notes', 'loyalty'] as const

function entrada(v: Campos): CustomerInput {
  const input: CustomerInput = {
    name: v.name ?? '',
    email: v.email ?? '',
    phone: v.phone ?? '',
    birthDate: v.birthDate ?? '',
    notes: v.notes ?? '',
  }
  if (v.loyalty === '1') input.isClubMember = v.isClubMember === 'on'
  return input
}

const lerFormulario = (fd: FormData): Campos => ler(fd, DADOS, ['isClubMember'])

export const criarCliente = tenantAction(
  'manage_clients',
  lerFormulario,
  async (ctx, v) => (await createCustomer(ctx, entrada(v))).id,
  (id) => {
    atualizarPainel()
    redirect(`/painel/clientes/${id}`)
  },
)

export const editarCliente = tenantAction(
  'manage_clients',
  lerFormulario,
  async (ctx, v) => {
    await updateCustomer(ctx, v.id ?? '', entrada(v))
    atualizarPainel()
    return `${v.name?.trim() ?? 'Cliente'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarCliente = tenantAction(
  'manage_clients',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await archiveCustomer(ctx, v.id ?? '')
    atualizarPainel()
    return 'Cliente arquivado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const restaurarCliente = tenantAction(
  'manage_clients',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await restoreCustomer(ctx, v.id ?? '')
    atualizarPainel()
    return 'Cliente restaurado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

/** Anonimizar apaga os dados pessoais para sempre: só vale com o nome do cadastro digitado igual, e o domínio conferido de novo. */
export const anonimizarCliente = tenantAction(
  'manage_clients',
  (fd) => ler(fd, ['id', 'confirmName']),
  async (ctx, v) => {
    const cliente = await getCustomer(ctx, v.id ?? '')
    if ((v.confirmName ?? '').trim() !== cliente.name) {
      throw erroDeCampo('confirmName', 'Digite o nome do cliente exatamente como está no cadastro para confirmar.')
    }
    await anonymizeCustomer(ctx, cliente.id)
    atualizarPainel()
    return 'Dados do cliente removidos.'
  },
  (mensagem, v) => feito(mensagem, { id: v.id ?? '' }),
)
