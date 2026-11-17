'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@/server/domain/errors'
import { createApiKey, listApiKeys, revokeApiKey } from '@/server/domain/platform/api-keys'
import { adminAction } from '../_lib/action'
import { erroDeCampo, feito, ler, linhasDe, porAlvo, renomear } from '../_lib/campos'
import type { Campos, EstadoGlobal } from '../_lib/campos'

/** Cria uma chave de PLATAFORMA (as de conta nascem na página da conta). O segredo volta uma vez, no estado. */
export async function criarChavePlataforma(prev: EstadoGlobal, fd: FormData): Promise<EstadoGlobal> {
  return adminAction(
    (f) => ler(f, ['name', 'origins']),
    async (admin, v: Campos) => {
      try {
        return await createApiKey(admin, { kind: 'PLATFORM', name: v.name ?? '', allowedOrigins: linhasDe(v.origins ?? '') })
      } catch (err) {
        throw renomear(err, { allowedOrigins: 'origins' })
      }
    },
    (r, v) => {
      revalidatePath('/dev/chaves')
      return feito('Chave criada.', v, { secret: r.secret, keyName: r.key.name, name: '', origins: '' })
    },
  )(prev, fd)
}

/** Revoga uma chave (de conta ou de plataforma). O id vem ligado no servidor; o nome digitado confere com o da chave. */
export const revogarChave = porAlvo(
  ['confirmName'],
  async (admin, v, keyId) => {
    const chave = (await listApiKeys(admin)).find((k) => k.id === keyId)
    if (!chave) throw new DomainError('not_found', 'Chave não encontrada.')
    if (v.confirmName !== chave.name) throw erroDeCampo('confirmName', 'Digite o nome da chave exatamente como aparece, para confirmar.')
    await revokeApiKey(admin, chave.id)
  },
  (_r, v) => {
    revalidatePath('/dev/chaves')
    return feito('Chave revogada.', { ...v, confirmName: '' })
  },
)
