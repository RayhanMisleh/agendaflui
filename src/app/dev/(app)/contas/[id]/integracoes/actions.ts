'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@/server/domain/errors'
import { clearFrenet, clearMercadoPago, setFrenet, setMercadoPago } from '@/server/domain/platform/integrations'
import type { IntegrationsView } from '@/server/domain/platform/integrations'
import { feito } from '@/app/_lib/campos'
import { adminAction } from '../../../_lib/action'
import type { PlatformAdminActor } from '../../../_lib/action'
import { MSG_CONFLITO } from '../forms'
import type { Campos, EstadoConta } from '../forms'

/*
 * Ações da aba Integrações. Os segredos digitados passam por aqui só até o domínio: eles NUNCA entram em `values` (o
 * estado do formulário que volta ao navegador), nem em erro, nem em log. O id da conta vem ligado pela página
 * (`salvarX.bind(null, id)`); a garantia é o guarda de admin, que roda em toda execução, antes de qualquer uso do que foi digitado.
 */

/** Campo em branco = "não mexa": só o que foi digitado vai ao domínio. */
function digitado(fd: FormData, nome: string): string | undefined {
  const x = fd.get(nome)
  return typeof x === 'string' && x.trim() !== '' ? x : undefined
}

async function comVersao<T>(p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (err) {
    if (err instanceof DomainError && err.reason === 'stale_version') {
      throw new DomainError('conflict', MSG_CONFLITO, { reason: 'stale_version' })
    }
    throw err
  }
}

/** Segredos digitados, lidos da requisição e guardados só no escopo da chamada (nunca em `values`). */
type Segredos = { accessToken: string | undefined; webhookSecret: string | undefined; token: string | undefined }

/**
 * Monta uma ação da aba: `(businessId, estado anterior, formulário)`. O guarda de admin roda por `adminAction`, antes
 * de qualquer uso do formulário; o `parse` devolve só a versão lida (é o que volta ao navegador em `values`).
 */
function porIntegracao(
  run: (admin: PlatformAdminActor, businessId: string, version: number, segredos: Segredos) => Promise<IntegrationsView>,
  mensagem: string,
) {
  return async (businessId: string, prev: EstadoConta, fd: FormData): Promise<EstadoConta> => {
    // Preenchido pelo `parse`, que `adminAction` só roda depois do guarda de admin: o formulário não é lido antes dele.
    let segredos: Segredos = { accessToken: undefined, webhookSecret: undefined, token: undefined }
    return adminAction(
      (f): Campos => {
        segredos = { accessToken: digitado(f, 'accessToken'), webhookSecret: digitado(f, 'webhookSecret'), token: digitado(f, 'token') }
        return { version: typeof f.get('version') === 'string' ? String(f.get('version')) : '' }
      },
      async (admin, v) => comVersao(run(admin, businessId, Number(v.version), segredos)),
      (view, v) => {
        revalidatePath('/dev/contas/[id]', 'layout')
        return feito(mensagem, v, { version: String(view.version) })
      },
    )(prev, fd)
  }
}

export const salvarMercadoPago = porIntegracao(
  (admin, businessId, version, { accessToken, webhookSecret }) =>
    setMercadoPago(admin, businessId, version, {
      ...(accessToken !== undefined ? { accessToken } : {}),
      ...(webhookSecret !== undefined ? { webhookSecret } : {}),
    }),
  'Mercado Pago salvo.',
)

export const removerMercadoPago = porIntegracao((admin, businessId, version) => clearMercadoPago(admin, businessId, version), 'Mercado Pago removido.')

export const salvarFrenet = porIntegracao((admin, businessId, version, { token }) => setFrenet(admin, businessId, version, { token: token ?? '' }), 'Frenet salva.')

export const removerFrenet = porIntegracao((admin, businessId, version) => clearFrenet(admin, businessId, version), 'Frenet removida.')
