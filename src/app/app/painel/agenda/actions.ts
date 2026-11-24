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
import { DomainError } from '@/server/domain/errors'
import { fromIsoInstant, isLocalDate, isLocalTime, toInstant, todayIn } from '@/server/time'
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
    let instante: Date
    try {
      instante = fromIsoInstant(v.startsAt ?? '')
    } catch {
      throw erroDeCampo('time', 'Escolha o horário de novo.')
    }
    // O instante escolhido na lista vale só para o dia que a tela mostrava: se o dia enviado é outro, a escolha ficou velha.
    const dia = (v.date ?? '').trim()
    if (dia !== '' && todayIn(fuso, instante) !== dia) throw erroDeCampo('date', 'O horário escolhido é de outro dia. Escolha o horário de novo.')
    return instante
  }
  const dia = (v.date ?? '').trim()
  const hora = (v.time ?? '').trim()
  if (!isLocalDate(dia)) throw erroDeCampo('date', 'Informe uma data válida.')
  if (!isLocalTime(hora)) throw erroDeCampo('time', 'Escolha o horário.')
  return toInstant(dia, hora, fuso)
}

/**
 * A duração livre da equipe: vazio = não enviar (vale a soma dos serviços); texto que não é número inteiro vira erro do
 * campo. A faixa (5 a 720) é do domínio.
 */
function duracaoDe(v: Campos): { durationMin?: number } {
  const texto = (v.durationMin ?? '').trim()
  if (texto === '') return {}
  if (!/^\d{1,4}$/.test(texto)) throw erroDeCampo('durationMin', 'Use de 5 a 720 minutos.')
  return { durationMin: Number(texto) }
}

/** A impressão da confirmação (`ack`): vazia = nenhuma. */
const confirmacaoDe = (v: Campos): { acknowledged?: string } => ((v.ack ?? '').trim() === '' ? {} : { acknowledged: (v.ack ?? '').trim() })

// ---------------------------------------------------------------- marcar

const MARCAR = ['customerId', 'petId', 'professionalId', 'startsAt', 'date', 'time', 'durationMin', 'ack', 'notes'] as const

export const marcarHorario = tenantAction(
  'view_own_agenda',
  (fd): Campos => ({ ...ler(fd, MARCAR), serviceIds: lista(fd, 'serviceIds') }),
  async (ctx, v) => {
    const customerId = (v.customerId ?? '').trim()
    if (customerId === '') throw erroDeCampo('customerId', 'Escolha o cliente.')
    const serviceIds = ids(v.serviceIds)
    if (serviceIds.length === 0) throw erroDeCampo('serviceIds', 'Escolha pelo menos um serviço.')
    const startsAt = instanteDe(v, ctx.timeZone)
    const duracao = duracaoDe(v)
    try {
      const marcado = await bookAppointment(ctx, {
        customerId,
        serviceIds,
        startsAt,
        ...((v.petId ?? '') === '' ? {} : { petId: v.petId ?? null }),
        ...duracao,
        ...confirmacaoDe(v),
        professionalId: (v.professionalId ?? '') === '' ? null : (v.professionalId ?? null),
        notes: (v.notes ?? '').trim() === '' ? null : (v.notes ?? '').trim(),
      })
      atualizarPainel()
      const quem = marcado.pet ? `${marcado.pet.name} (${marcado.customer.name})` : marcado.customer.name
      return `Horário marcado: ${quem}, ${marcado.local.start}.`
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
  undo: (ctx, id, v) => undoOutcome(ctx, id, confirmacaoDe(v)).then(() => 'Atendimento reaberto.'),
} satisfies Record<string, (ctx: Parameters<typeof confirmAppointment>[0], id: string, v: Campos) => Promise<string>>

export const mudarSituacao = tenantAction(
  'view_own_agenda',
  (fd) => ler(fd, ['id', 'to', 'reason', 'ack']),
  async (ctx, v) => {
    const id = v.id ?? ''
    let mensagem: string
    if (v.to === 'cancel') {
      await cancelAppointment(ctx, id, { reason: (v.reason ?? '').trim() === '' ? null : (v.reason ?? '').trim() })
      mensagem = 'Atendimento cancelado.'
    } else {
      const mudanca = Object.hasOwn(MUDANCAS, v.to ?? '') ? MUDANCAS[v.to as keyof typeof MUDANCAS] : undefined
      if (!mudanca) throw erroDeCampo('to', 'Escolha o que fazer com o atendimento.')
      mensagem = await mudanca(ctx, id, v)
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
  (fd): Campos => ({ ...ler(fd, ['id', 'petId', 'price', 'notes', 'durationMin', 'ack']), serviceIds: lista(fd, 'serviceIds') }),
  async (ctx, v) => {
    const atual = await getAppointment(ctx, v.id ?? '')
    const mudanca: { serviceIds?: string[]; petId?: string; durationMin?: number; totalCents?: number; notes?: string | null; acknowledged?: string } = { ...confirmacaoDe(v) }
    if ((v.petId ?? '') !== '' && v.petId !== atual.pet?.id) mudanca.petId = v.petId
    const servicos = ids(v.serviceIds)
    const antes = atual.items.map((i) => i.serviceId)
    if (servicos.length > 0 && (servicos.length !== antes.length || servicos.some((s) => !antes.includes(s)))) mudanca.serviceIds = servicos
    // Trocando pet ou serviços o domínio refaz a duração pela soma; a duração que o formulário mostra tem de ir junto, senão a livre se perde.
    const duracao = duracaoDe(v)
    const refaz = mudanca.petId !== undefined || mudanca.serviceIds !== undefined
    if (duracao.durationMin !== undefined && (refaz || duracao.durationMin !== atual.totalDurationMin)) mudanca.durationMin = duracao.durationMin
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
  (fd) => ler(fd, ['id', 'professionalId', 'startsAt', 'date', 'time', 'fromStartsAt', 'fromProfessionalId', 'durationMin', 'ack']),
  async (ctx, v) => {
    const startsAt = instanteDe(v, ctx.timeZone)
    // A tela manda de onde o atendimento saía (início e profissional que ela mostrava): se já não está lá, alguém mexeu.
    if ((v.fromStartsAt ?? '') !== '' || (v.fromProfessionalId ?? '') !== '') {
      const atual = await getAppointment(ctx, v.id ?? '')
      const origemInicio = (v.fromStartsAt ?? '') === '' ? null : (v.fromStartsAt ?? '')
      let mudou = (v.fromProfessionalId ?? '') !== '' && v.fromProfessionalId !== atual.professional.id
      if (origemInicio !== null) {
        try {
          mudou = mudou || fromIsoInstant(origemInicio).getTime() !== atual.startsAt.getTime()
        } catch {
          mudou = true
        }
      }
      if (mudou) throw new DomainError('conflict', 'Este atendimento mudou agora. Recarregue para ver.')
    }
    const duracao = duracaoDe(v)
    try {
      const r = await rescheduleAppointment(ctx, v.id ?? '', { startsAt, ...duracao, ...confirmacaoDe(v), ...((v.professionalId ?? '') === '' ? {} : { professionalId: v.professionalId ?? null }) })
      atualizarPainel()
      return `${r.customer.name} remarcado para ${r.local.start} com ${r.professional.name}.`
    } catch (err) {
      throw renomear(err, { startsAt: 'time' })
    }
  },
  (mensagem, v) => feito(mensagem, v),
)
