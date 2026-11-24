'use server'
import { redirect } from 'next/navigation'
import type { MembershipRole } from '@/server/db/generated/client'
import { addTeamMember, changeAccessRole, inviteAccess, resendAccessInvite, sendAccessPasswordReset, setAccessActive } from '@/server/domain/team/access'
import { updateProfessional } from '@/server/domain/team/professionals'
import { removeProfessional } from '@/server/domain/team/removal'
import { createTimeBlock, deleteTimeBlock, previewTimeBlock } from '@/server/domain/team/time-blocks'
import { setWeekSchedule } from '@/server/domain/team/working-hours'
import type { DayRanges, WeekSchedule } from '@/server/domain/team/working-hours'
import { WEEKDAYS, isLocalDate, isLocalTime, parseMinuteLabel, toInstant } from '@/server/time'
import { conviteNaoEnviado, erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { DomainError } from '@/server/domain/errors'
import { parsePercentBps } from '@/shared/percent'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'

/*
 * Ações da tela de equipe. Gerir fichas, serviços, comissão e acessos pede `manage_team`. Expediente, bloqueios e a foto
 * pedem só `manage_own_availability` aqui, e o domínio estreita: o profissional mexe na PRÓPRIA ficha, nunca na do colega.
 * O `id` da ficha (ou do acesso) vem em campo escondido; o domínio só o encontra dentro da conta ativa.
 */

const PAPEIS: readonly MembershipRole[] = ['OWNER', 'MANAGER', 'PROFESSIONAL']
const papel = (texto: string | undefined): MembershipRole => PAPEIS.find((p) => p === texto) ?? 'PROFESSIONAL'

function comissao(texto: string | undefined): number {
  const bps = parsePercentBps((texto ?? '').trim())
  if (bps === null) throw erroDeCampo('commission', 'Informe uma porcentagem de 0 a 100, por exemplo 30 ou 12,5.')
  return bps
}

function listaDe(fd: FormData, nome: string): string {
  return fd
    .getAll(nome)
    .filter((v): v is string => typeof v === 'string')
    .join(',')
}

/** Lê os campos nomeados e junta os valores repetidos de `lista` (caixas de marcar) numa linha separada por vírgula. */
function comLista(fd: FormData, nomes: readonly string[], lista: string, caixas: readonly string[] = []): Campos {
  return { ...ler(fd, nomes, caixas), [lista]: listaDe(fd, lista) }
}

// ---------------------------------------------------------------- fichas

const DADOS = ['id', 'name', 'bio', 'commission'] as const

function papelDoCadastro(texto: string | undefined): 'PROFESSIONAL' | 'MANAGER' {
  if (texto === 'PROFESSIONAL' || texto === 'MANAGER') return texto
  throw erroDeCampo('role', 'Escolha Profissional ou Gerente.')
}

/** Cadastro num passo: nome, e-mail e papel criam a ficha, o acesso e o convite. Depois abre a ficha nova. */
export const cadastrarNaEquipe = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['name', 'email', 'role']),
  async (ctx, v) => {
    const membro = await addTeamMember(ctx, { name: v.name ?? '', email: v.email ?? '', role: papelDoCadastro(v.role) })
    return membro.professionalId
  },
  (id) => {
    atualizarPainel()
    redirect(id ? `/painel/equipe/${id}` : '/painel/equipe')
  },
)

export const salvarDadosProfissional = tenantAction(
  'manage_team',
  (fd) => ler(fd, DADOS, ['active']),
  async (ctx, v) => {
    try {
      await updateProfessional(ctx, v.id ?? '', { name: v.name ?? '', bio: v.bio ?? '', commissionBps: comissao(v.commission), active: v.active === 'on' })
    } catch (err) {
      throw renomear(err, { commissionBps: 'commission' })
    }
    atualizarPainel()
    return `${v.name?.trim() ?? 'Ficha'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

export const salvarServicosProfissional = tenantAction(
  'manage_team',
  (fd) => comLista(fd, ['id'], 'serviceIds'),
  async (ctx, v) => {
    await updateProfessional(ctx, v.id ?? '', { serviceIds: (v.serviceIds ?? '').split(',').filter((s) => s !== '') })
    atualizarPainel()
    return 'Serviços salvos.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const arquivarProfissional = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await removeProfessional(ctx, v.id ?? '')
    atualizarPainel()
    return 'Ficha arquivada e acesso desativado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- expediente

const CAMPO_DE_FAIXA = /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\.(\d+)\.(start|end)$/

/** Lê todos os campos `DIA.n.start|end` do formulário, sem perder o nome de nenhum (a tela reexibe o que foi digitado). */
function lerExpediente(fd: FormData): Campos {
  const v: Campos = { id: String(fd.get('id') ?? '') }
  for (const [chave, valor] of fd.entries()) if (CAMPO_DE_FAIXA.test(chave) && typeof valor === 'string') v[chave] = valor
  return v
}

/** Do formulário para o expediente do domínio: todos os dias entram (dia sem faixa fica fechado). Erros apontam a faixa. */
function expedienteDe(v: Campos): WeekSchedule {
  const semana = {} as WeekSchedule
  const erros: Record<string, string> = {}
  for (const dia of WEEKDAYS) {
    const faixas: DayRanges = []
    const indices = [...new Set(Object.keys(v).flatMap((k) => (k.startsWith(`${dia}.`) ? [Number(k.split('.')[1])] : [])))].sort((a, b) => a - b)
    for (const i of indices) {
      const ini = (v[`${dia}.${i}.start`] ?? '').trim()
      const fim = (v[`${dia}.${i}.end`] ?? '').trim()
      if (!isLocalTime(ini)) erros[`${dia}.${i}.start`] = 'Use o horário no formato HH:mm, por exemplo 09:00.'
      if (!isLocalTime(fim)) erros[`${dia}.${i}.end`] = 'Use o horário no formato HH:mm, por exemplo 18:00.'
      if (isLocalTime(ini) && isLocalTime(fim)) faixas.push({ startMin: parseMinuteLabel(ini), endMin: parseMinuteLabel(fim) })
      else faixas.push({ startMin: 0, endMin: 0 })
    }
    semana[dia] = faixas
  }
  if (Object.keys(erros).length > 0) throw new DomainError('validation', 'Confira os horários informados e tente de novo.', { fields: erros })
  return semana
}

/** O domínio chama os lados da faixa de `startMin` e `endMin`; o formulário, de `start` e `end`. */
function faixaDoFormulario(err: unknown): unknown {
  if (!(err instanceof DomainError) || !err.fields) return err
  const fields = Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [k.replace(/\.startMin$/, '.start').replace(/\.endMin$/, '.end'), m]))
  return new DomainError(err.code, err.message, { fields, ...(err.reason ? { reason: err.reason } : {}) })
}

export const salvarExpediente = tenantAction(
  'manage_own_availability',
  lerExpediente,
  async (ctx, v) => {
    try {
      await setWeekSchedule(ctx, v.id ?? '', expedienteDe(v))
    } catch (err) {
      throw faixaDoFormulario(err)
    }
    atualizarPainel()
    return 'Expediente salvo.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- bloqueios

const BLOQUEIO = ['id', 'startDate', 'startTime', 'endDate', 'endTime', 'reason', 'confirm'] as const

function instante(v: Campos, dia: 'startDate' | 'endDate', hora: 'startTime' | 'endTime', fuso: string): Date {
  const d = (v[dia] ?? '').trim()
  const h = (v[hora] ?? '').trim()
  if (!isLocalDate(d)) throw erroDeCampo(dia, 'Informe uma data válida.')
  if (!isLocalTime(h)) throw erroDeCampo(hora, 'Informe a hora no formato HH:mm.')
  return toInstant(d, h, fuso)
}

type ResultadoBloqueio = { gravado: true } | { gravado: false; afetados: number; assinatura: string }

/** O que foi confirmado: o intervalo exato que a pessoa viu no aviso. Mudar qualquer campo invalida a confirmação. */
const assinaturaDe = (v: Campos): string => [v.id, v.startDate, v.startTime, v.endDate, v.endTime].join('|')

/**
 * Bloqueia um horário. A data e a hora são as da conta. Se o intervalo cobre agendamentos, a primeira chamada não grava:
 * devolve quantos são (em `values.affected`) e o que deve ser confirmado (`values.confirm`, ligado ao intervalo exato). Sem agendamentos, grava direto.
 */
export const bloquearHorario = tenantAction(
  'manage_own_availability',
  (fd) => ler(fd, BLOQUEIO),
  async (ctx, v): Promise<ResultadoBloqueio> => {
    const intervalo = { professionalId: v.id ?? '', startsAt: instante(v, 'startDate', 'startTime', ctx.timeZone), endsAt: instante(v, 'endDate', 'endTime', ctx.timeZone) }
    try {
      const { affectedAppointments } = await previewTimeBlock(ctx, intervalo)
      if (affectedAppointments > 0 && v.confirm !== assinaturaDe(v)) return { gravado: false, afetados: affectedAppointments, assinatura: assinaturaDe(v) }
      await createTimeBlock(ctx, { ...intervalo, reason: v.reason ?? '' })
    } catch (err) {
      throw renomear(err, { startsAt: 'startDate', endsAt: 'endTime' })
    }
    atualizarPainel()
    return { gravado: true }
  },
  (r, v) =>
    r.gravado
      ? feito('Horário bloqueado.', { ...v, confirm: '' })
      : {
          ok: false,
          message: `Este bloqueio atinge ${r.afetados} ${r.afetados === 1 ? 'agendamento' : 'agendamentos'}. Eles não são cancelados. Confirme para bloquear mesmo assim.`,
          fields: {},
          values: { ...v, affected: String(r.afetados), confirm: r.assinatura },
        },
)

export const removerBloqueio = tenantAction(
  'manage_own_availability',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await deleteTimeBlock(ctx, v.id ?? '')
    atualizarPainel()
    return 'Bloqueio removido.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- acessos

export const convidarAcesso = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['id', 'name', 'email', 'role']),
  async (ctx, v) => {
    const membro = await inviteAccess(ctx, { name: v.name ?? '', email: v.email ?? '', role: papel(v.role), professionalId: v.id ?? '' })
    atualizarPainel()
    return membro.inviteMailFailed
  },
  (falhou, v) => (falhou ? conviteNaoEnviado(v) : feito(`Convite enviado para ${v.email?.trim() || 'o e-mail informado'}.`, v)),
)

export const mudarPapelAcesso = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['membershipId', 'role']),
  async (ctx, v) => {
    await changeAccessRole(ctx, v.membershipId ?? '', papel(v.role))
    atualizarPainel()
    return 'Papel alterado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const alternarAcesso = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['membershipId', 'active']),
  async (ctx, v) => {
    const ativar = v.active === '1'
    await setAccessActive(ctx, v.membershipId ?? '', ativar)
    atualizarPainel()
    return ativar ? 'Acesso reativado.' : 'Acesso desativado. A pessoa saiu de todos os aparelhos.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const reenviarConviteAcesso = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['membershipId']),
  async (ctx, v) => {
    const { inviteMailFailed } = await resendAccessInvite(ctx, v.membershipId ?? '')
    // A situação (enviado ou não) vem do banco: a ficha e a lista se atualizam e mostram o que aconteceu com o e-mail.
    atualizarPainel()
    return inviteMailFailed
  },
  (falhou, v) => (falhou ? conviteNaoEnviado(v) : feito('Convite reenviado.', v)),
)

export const redefinirSenhaAcesso = tenantAction(
  'manage_team',
  (fd) => ler(fd, ['membershipId']),
  async (ctx, v) => {
    await sendAccessPasswordReset(ctx, v.membershipId ?? '')
    return 'Redefinição de senha enviada por e-mail.'
  },
  (mensagem, v) => feito(mensagem, v),
)
