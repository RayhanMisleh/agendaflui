'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@/server/domain/errors'
import { clearGoogleSettings, saveGoogleSettings } from '@/server/domain/platform/google-settings'
import type { GoogleSettingsView } from '@/server/domain/platform/google-settings'
import { feito } from '@/app/_lib/campos'
import type { Campos, EstadoCampos } from '@/app/_lib/campos'
import { adminAction } from '../../_lib/action'
import type { PlatformAdminActor } from '../../_lib/action'

/*
 * Ações da tela Google. A chave secreta digitada passa por aqui só até o domínio: ela NUNCA entra em `values` (o estado
 * do formulário que volta ao navegador), nem em erro, nem em log. O guarda de admin roda em toda execução, antes de ler o formulário.
 */

const MSG_CONFLITO = 'Outra pessoa alterou as chaves do Google. Recarregue a página e refaça a alteração.'

function porGoogle(run: (admin: PlatformAdminActor, v: Campos, segredo: string | null) => Promise<GoogleSettingsView>, mensagem: string) {
  return async (prev: EstadoCampos, fd: FormData): Promise<EstadoCampos> => {
    // Preenchido pelo `parse`, que `adminAction` só roda depois do guarda de admin.
    let segredo: string | null = null
    return adminAction(
      (f): Campos => {
        const s = f.get('clientSecret')
        segredo = typeof s === 'string' && s.trim() !== '' ? s : null
        const id = f.get('clientId')
        const versao = f.get('version')
        return { clientId: typeof id === 'string' ? id : '', version: typeof versao === 'string' ? versao : '' }
      },
      async (admin, v) => {
        try {
          return await run(admin, v, segredo)
        } catch (err) {
          if (err instanceof DomainError && err.reason === 'stale_version') throw new DomainError('conflict', MSG_CONFLITO, { reason: 'stale_version' })
          throw err
        }
      },
      (view, v) => {
        revalidatePath('/sistema/google')
        return feito(mensagem, v, { version: String(view.version), clientId: view.clientId ?? '' })
      },
    )(prev, fd)
  }
}

export const salvarGoogle = porGoogle(
  (admin, v, segredo) => saveGoogleSettings(admin, { clientId: v.clientId ?? '', clientSecret: segredo }, Number(v.version), new Date()),
  'Chaves do Google salvas.',
)

export const removerGoogle = porGoogle((admin, v) => clearGoogleSettings(admin, Number(v.version), new Date()), 'Chaves do Google removidas.')
