'use server'
import { AuthError } from '@/server/auth/actor'
import { APP_COOKIE, readCookie } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { changeOwnAccountPassword, updateOwnAccountProfile } from '@/server/domain/account/profile'
import { updateBusinessProfile } from '@/server/domain/settings/business-profile'
import { createClosure, deleteClosure, previewClosure } from '@/server/domain/settings/closures'
import { DEFAULT_NOTIFICATION_SETTINGS, updateNotificationSettings } from '@/server/domain/settings/notification-settings'
import type { NotificationSettings } from '@/server/domain/settings/notification-settings'
import { updateSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'
import { comConflito } from './versao'

/*
 * Ações da tela de configurações. Cada seção grava sozinha e passa por `tenantAction`: a capacidade é conferida aqui e de
 * novo no domínio. Termos, regras e avisos dividem uma só versão (`business_settings.version`): o formulário leva a versão
 * que a página leu, e depois de cada gravação a página é recarregada para trazer a nova. Versão velha vira o aviso de
 * conflito e o que a pessoa digitou volta nos campos.
 */

const versao = (v: Campos): number => Number(v.version)

const NEGOCIO = ['version', 'name', 'contactEmail', 'contactPhone'] as const

export const salvarNegocio = tenantAction(
  'manage_account',
  (fd) => ler(fd, NEGOCIO),
  async (ctx, v) => {
    try {
      await updateBusinessProfile(ctx, versao(v), {
        name: v.name ?? '',
        contactEmail: v.contactEmail ?? '',
        contactPhone: v.contactPhone ?? '',
      })
    } catch (err) {
      throw comConflito(err)
    }
    atualizarPainel()
    return 'Dados salvos.'
  },
  (mensagem, v) => feito(mensagem, v),
)

const NUMEROS_REGRAS = ['slotStepMin', 'minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin'] as const

export const salvarRegras = tenantAction(
  'manage_settings',
  (fd) => ler(fd, ['version', ...NUMEROS_REGRAS], ['autoConfirm']),
  async (ctx, v) => {
    for (const n of NUMEROS_REGRAS) {
      if ((v[n] ?? '').trim() === '') throw erroDeCampo(n, 'Preencha este campo com um número.')
    }
    try {
      await updateSchedulingRules(
        ctx,
        {
          slotStepMin: Number(v.slotStepMin),
          minLeadMin: Number(v.minLeadMin),
          maxAdvanceDays: Number(v.maxAdvanceDays),
          customerChangeWindowMin: Number(v.customerChangeWindowMin),
          bufferMin: Number(v.bufferMin),
          autoConfirm: v.autoConfirm === 'on',
        },
        versao(v),
      )
    } catch (err) {
      throw comConflito(err)
    }
    atualizarPainel()
    return 'Regras salvas.'
  },
  (mensagem, v) => feito(mensagem, v),
)

const TIPOS_DE_AVISO = Object.keys(DEFAULT_NOTIFICATION_SETTINGS)

/** Uma caixa por tipo (`TIPO__email`); caixa desmarcada desliga. */
export const salvarAvisos = tenantAction(
  'manage_settings',
  (fd) => ler(fd, ['version'], TIPOS_DE_AVISO.map((k) => `${k}__email`)),
  async (ctx, v) => {
    const todos = Object.fromEntries(TIPOS_DE_AVISO.map((k) => [k, { email: v[`${k}__email`] === 'on' }]))
    try {
      await updateNotificationSettings(ctx, todos as NotificationSettings, versao(v))
    } catch (err) {
      throw comConflito(err)
    }
    atualizarPainel()
    return 'Avisos salvos.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- fechamentos

/** O que foi confirmado: o intervalo exato que a pessoa viu no aviso. Mudar uma data pede nova confirmação. */
const assinaturaDe = (v: Campos): string => [v.startDate, v.endDate].join('|')

type ResultadoFechamento = { gravado: true } | { gravado: false; afetados: number; assinatura: string }

/**
 * Cria um fechamento. Se o intervalo cobre agendamentos, a primeira chamada não grava: devolve quantos são e a assinatura
 * do intervalo (`values.confirm`); só com ela de volta o fechamento é criado. Os agendamentos não são cancelados.
 */
export const criarFechamento = tenantAction(
  'manage_settings',
  (fd) => ler(fd, ['startDate', 'endDate', 'reason', 'confirm']),
  async (ctx, v): Promise<ResultadoFechamento> => {
    const intervalo = { startDate: v.startDate ?? '', endDate: v.endDate ?? '' }
    const { affectedAppointments } = await previewClosure(ctx, intervalo)
    if (affectedAppointments > 0 && v.confirm !== assinaturaDe(v)) {
      return { gravado: false, afetados: affectedAppointments, assinatura: assinaturaDe(v) }
    }
    await createClosure(ctx, { ...intervalo, reason: v.reason ?? '' })
    atualizarPainel()
    return { gravado: true }
  },
  (r, v) =>
    r.gravado
      ? feito('Fechamento criado.', { ...v, confirm: '', startDate: '', endDate: '', reason: '' })
      : {
          ok: false,
          message: `Este fechamento cobre ${r.afetados} ${r.afetados === 1 ? 'agendamento' : 'agendamentos'}. Eles não são cancelados. Confirme para fechar mesmo assim.`,
          fields: {},
          values: { ...v, affected: String(r.afetados), confirm: r.assinatura },
        },
)

export const removerFechamento = tenantAction(
  'manage_settings',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await deleteClosure(ctx, v.id ?? '')
    atualizarPainel()
    return 'Fechamento removido.'
  },
  (mensagem, v) => feito(mensagem, v),
)

// ---------------------------------------------------------------- meu perfil

/** Todo membro da equipe muda o próprio nome; em modo suporte o domínio recusa (não há "eu"). */
export const salvarPerfil = tenantAction(
  null,
  (fd) => ler(fd, ['name']),
  async (ctx, v) => {
    await updateOwnAccountProfile(ctx, { name: v.name ?? '' })
    atualizarPainel()
    return 'Perfil salvo.'
  },
  (mensagem, v) => feito(mensagem, v),
)

/**
 * Troca a própria senha. Os nomes dos campos têm "senha" de propósito: o estado do formulário nunca devolve esses valores
 * ao navegador. A sessão atual continua; as outras e os tokens do app caem.
 */
export const trocarSenha = tenantAction(
  null,
  (fd) => ler(fd, ['senhaAtual', 'senhaNova', 'senhaConfirma']),
  async (ctx, v) => {
    if (v.senhaNova !== v.senhaConfirma) throw erroDeCampo('senhaConfirma', 'As duas senhas novas precisam ser iguais.')
    const sessao = (await readCookie(APP_COOKIE)) ?? ''
    try {
      await changeOwnAccountPassword(ctx, { current: v.senhaAtual ?? '', next: v.senhaNova ?? '' }, sessao)
    } catch (err) {
      if (err instanceof AuthError) throw new DomainError('conflict', err.message)
      throw renomear(err, { current: 'senhaAtual', next: 'senhaNova' })
    }
    return 'Senha trocada.'
  },
  (mensagem, v) => feito(mensagem, { ...v, senhaAtual: '', senhaNova: '', senhaConfirma: '' }),
)
