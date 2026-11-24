'use server'
import { redirect } from 'next/navigation'
import type { MembershipRole } from '@/server/db/generated/client'
import { addTeamMember, changeAccessRole, inviteAccess, resendAccessInvite, sendAccessPasswordReset, setAccessActive } from '@/server/domain/team/access'
import { updateProfessional } from '@/server/domain/team/professionals'
import { removeProfessional } from '@/server/domain/team/removal'
import { createTimeBlock, deleteTimeBlock, previewTimeBlock } from '@/server/domain/team/time-blocks'
import { setWeekSchedule } from '@/server/domain/team/working-hours'
import { isLocalDate, isLocalTime, toInstant } from '@/server/time'
import { conviteNaoEnviado, erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { parsePercentBps } from '@/shared/percent'
import { expedienteDe, faixaDoFormulario, lerFaixas } from '../_lib/expediente'
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

/** Lê as faixas do formulário e o `id` da ficha. */
function lerExpediente(fd: FormData): Campos {
  return lerFaixas(fd, { id: String(fd.get('id') ?? '') })
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
