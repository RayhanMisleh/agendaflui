'use server'
import { redirect } from 'next/navigation'
import { createBanner, deleteBanner, moveBanner, updateBanner } from '@/server/domain/banners/banners'
import { feito, ler } from '@/app/_lib/campos'
import type { Campos } from '@/app/_lib/campos'
import { tenantAction } from '../_lib/action'
import { atualizarPainel } from '../_lib/revalidar'

/*
 * Ações da tela de banners. Todas passam por `tenantAction('manage_banners')` e o domínio confere de novo (inclusive o
 * módulo ligado). O `id` vem em campo escondido e o domínio só o encontra dentro da conta ativa.
 */

const DADOS = ['id', 'title', 'linkUrl', 'startsOn', 'endsOn'] as const

const entrada = (v: Campos) => ({ title: v.title ?? '', linkUrl: v.linkUrl ?? '', startsOn: v.startsOn ?? '', endsOn: v.endsOn ?? '' })

export const criarBanner = tenantAction(
  'manage_banners',
  (fd) => ler(fd, DADOS),
  async (ctx, v) => (await createBanner(ctx, { ...entrada(v), active: false })).id,
  (id) => {
    atualizarPainel()
    redirect(`/painel/banners/${id}`)
  },
)

export const salvarBanner = tenantAction(
  'manage_banners',
  (fd) => ler(fd, DADOS, ['active']),
  async (ctx, v) => {
    await updateBanner(ctx, v.id ?? '', { ...entrada(v), active: v.active === 'on' })
    atualizarPainel()
    return `${v.title?.trim() ?? 'Banner'} salvo.`
  },
  (mensagem, v) => feito(mensagem, v),
)

/** Liga (`active=1`) ou desliga (`active=0`) pela lista. Sem imagem o domínio recusa e a mensagem aparece na linha. */
export const alternarBanner = tenantAction(
  'manage_banners',
  (fd) => ler(fd, ['id', 'active']),
  async (ctx, v) => {
    const ativar = v.active === '1'
    await updateBanner(ctx, v.id ?? '', { active: ativar })
    atualizarPainel()
    return ativar ? 'Banner ativado.' : 'Banner desativado.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const moverBanner = tenantAction(
  'manage_banners',
  (fd) => ler(fd, ['id', 'direction']),
  async (ctx, v) => {
    await moveBanner(ctx, v.id ?? '', v.direction === 'up' ? 'up' : 'down')
    atualizarPainel()
    return 'Ordem alterada.'
  },
  (mensagem, v) => feito(mensagem, v),
)

export const excluirBanner = tenantAction(
  'manage_banners',
  (fd) => ler(fd, ['id']),
  async (ctx, v) => {
    await deleteBanner(ctx, v.id ?? '')
    atualizarPainel()
    return 'Banner excluído.'
  },
  (mensagem, v) => feito(mensagem, v),
)
