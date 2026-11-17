'use server'
import { notifyProfessionalFreeEarly } from '@/server/domain/notifications/outbox'
import {
  adjustAppointment,
  bookAppointment,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  getAppointment,
  markNoShow,
  rescheduleAppointment,
  undoOutcome,
} from '@/server/domain/scheduling/appointments'
import { fromIsoInstant, isLocalDate, isLocalTime, toInstant } from '@/server/time'
import { erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { parseMoney } from '@/ui/money'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'

/*
 * Ações da agenda. Todas pedem só `view_own_agenda` (todo membro tem); quem pode agir em qual agenda é do domínio, que
 * recusa o profissional na agenda do colega. A tela manda o horário como o instante que recebeu do servidor (`startsAt`) ou,
 * na marcação fora da lista, dia e hora locais que o servidor converte no fuso da conta.
 */

function lista(fd: FormData, nome: string): string {
  return fd
    .getAll(nome)
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .join(',')
}

const ids = (texto: string | undefined): string[] => (texto ?? '').split(',').filter((s) => s !== '')

/** O horário escolhido: o instante que o servidor ofereceu (`startsAt`) ou, no formulário, dia e hora locais da conta. */
function instanteDe(v: Campos, fuso: string): Date {
  if ((v.startsAt ?? '') !== '') {
    try {
      return fromIsoInstant(v.startsAt ?? '')
    } catch {
      throw erroDeCampo('time', 'Escolha o horário de novo.')
    }
  }
  const dia = (v.date ?? '').trim()
  const hora = (v.time ?? '').trim()
  if (!isLocalDate(dia)) throw erroDeCampo('date', 'Informe uma data válida.')
  if (!isLocalTime(hora)) throw erroDeCampo('time', 'Escolha o horário.')
  return toInstant(dia, hora, fuso)
}

// ---------------------------------------------------------------- marcar

const MARCAR = ['customerId', 'professionalId', 'startsAt', 'date', 'time', 'notes'] as const

export const marcarHorario = tenantAction(
  'view_own_agenda',
  (fd): Campos => ({ ...ler(fd, MARCAR), serviceIds: lista(fd, 'serviceIds') }),
  async (ctx, v) => {
    const customerId = (v.customerId ?? '').trim()
    if (customerId === '') throw erroDeCampo('customerId', 'Escolha o cliente.')
    const serviceIds = ids(v.serviceIds)
    if (serviceIds.length === 0) throw erroDeCampo('serviceIds', 'Escolha pelo menos um serviço.')
    const startsAt = instanteDe(v, ctx.timeZone)
    try {
      const marcado = await bookAppointment(ctx, {
        customerId,
        serviceIds,
        startsAt,
        professionalId: (v.professionalId ?? '') === '' ? null : (v.professionalId ?? null),
        notes: (v.notes ?? '').trim() === '' ? null : (v.notes ?? '').trim(),
      })
      atualizarPainel()
      return `Horário marcado: ${marcado.customer.name}, ${marcado.local.start}.`
    } catch (err) {
      throw renomear(err, { startsAt: 'time' })
    }
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- situação

const MUDANCAS = {
  confirm: (ctx, id) => confirmAppointment(ctx, id).then(() => 'Atendimento confirmado.'),
  complete: (ctx, id) => completeAppointment(ctx, id).then(() => 'Atendimento concluído.'),
  noshow: (ctx, id) => markNoShow(ctx, id).then(() => 'Falta registrada.'),
  undo: (ctx, id) => undoOutcome(ctx, id).then(() => 'Atendimento reaberto.'),
} satisfies Record<string, (ctx: Parameters<typeof confirmAppointment>[0], id: string) => Promise<string>>

export const mudarSituacao = tenantAction(
  'view_own_agenda',
  (fd) => ler(fd, ['id', 'to', 'reason']),
  async (ctx, v) => {
    const id = v.id ?? ''
    let mensagem: string
    if (v.to === 'cancel') {
      await cancelAppointment(ctx, id, { reason: (v.reason ?? '').trim() === '' ? null : (v.reason ?? '').trim() })
      mensagem = 'Atendimento cancelado.'
    } else {
      const mudanca = Object.hasOwn(MUDANCAS, v.to ?? '') ? MUDANCAS[v.to as keyof typeof MUDANCAS] : undefined
      if (!mudanca) throw erroDeCampo('to', 'Escolha o que fazer com o atendimento.')
      mensagem = await mudanca(ctx, id)
    }
    atualizarPainel()
    return mensagem
  },
  (mensagem, v) => feito(mensagem, v),
)

export const avisarLivre = tenantAction(
  'view_own_agenda',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await notifyProfessionalFreeEarly(ctx, v.id ?? '')
    atualizarPainel()
    return 'Aviso enviado: o cliente sabe que você já está livre.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- ajustes

/**
 * Serviços e valor só vão ao domínio quando mudaram: mandar os serviços de novo recalcularia o total, e o valor combinado
 * com o cliente se perderia.
 */
export const ajustarAtendimento = tenantAction(
  'view_own_agenda',
  (fd): Campos => ({ ...ler(fd, ['id', 'price', 'notes']), serviceIds: lista(fd, 'serviceIds') }),
  async (ctx, v) => {
    const atual = await getAppointment(ctx, v.id ?? '')
    const mudanca: { serviceIds?: string[]; totalCents?: number; notes?: string | null } = {}
    const servicos = ids(v.serviceIds)
    const antes = atual.items.map((i) => i.serviceId)
    if (servicos.length > 0 && (servicos.length !== antes.length || servicos.some((s) => !antes.includes(s)))) mudanca.serviceIds = servicos
    const preco = (v.price ?? '').trim()
    if (preco !== '') {
      const centavos = parseMoney(preco)
      if (centavos === null) throw erroDeCampo('price', 'Digite o valor em reais, por exemplo 35,90.')
      if (centavos !== atual.totalCents) mudanca.totalCents = centavos
    }
    const notas = (v.notes ?? '').trim()
    if (notas !== (atual.notes ?? '')) mudanca.notes = notas === '' ? null : notas
    try {
      await adjustAppointment(ctx, atual.id, mudanca)
    } catch (err) {
      throw renomear(err, {})
    }
    atualizarPainel()
    return 'Atendimento salvo.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- remarcar

/**
 * Remarcar: a tela manda o dia local e os minutos locais (arrastar e teclado) ou o instante que o servidor ofereceu (folha).
 * `professionalId` vazio mantém o profissional. Conflito volta com os horários livres mais próximos e nada muda.
 */
export const remarcarAtendimento = tenantAction(
  'view_own_agenda',
  (fd) => ler(fd, ['id', 'professionalId', 'startsAt', 'date', 'time']),
  async (ctx, v) => {
    const startsAt = instanteDe(v, ctx.timeZone)
    try {
      const r = await rescheduleAppointment(ctx, v.id ?? '', { startsAt, ...((v.professionalId ?? '') === '' ? {} : { professionalId: v.professionalId ?? null }) })
      atualizarPainel()
      return `${r.customer.name} remarcado para ${r.local.start} com ${r.professional.name}.`
    } catch (err) {
      throw renomear(err, { startsAt: 'time' })
    }
  },
  (mensagem, v) => feito(mensagem, v),
)
