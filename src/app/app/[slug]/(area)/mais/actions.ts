'use server'
import { redirect } from 'next/navigation'
import { erroDeCampo, feito, ler } from '@/app/_lib/campos'
import type { FormState } from '@/app/_lib/form-state'
import { AuthError } from '@/server/auth/actor'
import { APP_COOKIE, clearSessionCookie, readCookie } from '@/server/auth/guards'
import { deleteStoreAccount } from '@/server/auth/store-leave'
import { DomainError } from '@/server/domain/errors'
import { updateNotificationPreferences } from '@/server/domain/customers/preferences'
import { clienteAction } from '../../_lib/acao'
import { atualizarLoja } from '../../_lib/revalidar'

/*
 * Ações de Mais. O cliente e a pessoa vêm sempre da sessão (`clienteAction`): nenhum id é lido do formulário. Avisos mexem só
 * no cadastro do cliente desta loja; excluir apaga a conta SÓ nesta loja e confirma a identidade (senha, ou "excluir").
 */

export const salvarAvisos = clienteAction(
  (fd) => ler(fd, [], ['emailAppointments', 'emailMarketing']),
  async (v, c) => {
    await updateNotificationPreferences(v.ctx, { emailAppointments: c.emailAppointments === 'on', emailMarketing: c.emailMarketing === 'on' })
    atualizarLoja()
    return 'Avisos salvos.'
  },
  (mensagem, c) => feito(mensagem, c),
)

export const excluirConta = clienteAction(
  (fd) => ler(fd, ['password', 'confirm']),
  async (v, c) => {
    const token = (await readCookie(APP_COOKIE)) ?? ''
    if ((c.password ?? '') === '' && (c.confirm ?? '').trim() === '') throw erroDeCampo('confirm', 'Confirme para excluir.')
    try {
      const r = await deleteStoreAccount(
        {
          userId: v.person.userId,
          businessId: v.store.businessId,
          customerId: v.customerId,
          password: c.password ?? '',
          confirm: c.confirm ?? '',
          sessionToken: token,
        },
        { ...(v.ctx.request.ip ? { ip: v.ctx.request.ip } : {}), ...(v.ctx.request.userAgent ? { userAgent: v.ctx.request.userAgent } : {}) },
        v.ctx.clock(),
      )
      // A pessoa foi apagada junto: a sessão não existe mais e o cookie some também.
      if (r.personDeleted) await clearSessionCookie(APP_COOKIE)
      return r.nextPath
    } catch (err) {
      if (err instanceof AuthError) throw new DomainError('conflict', err.message, { reason: 'rate_limited' })
      throw err
    }
  },
  (proximo): FormState<Record<string, string>> => redirect(proximo),
)
