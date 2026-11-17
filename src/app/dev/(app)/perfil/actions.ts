'use server'
import { revalidatePath } from 'next/cache'
import { AuthError } from '@/server/auth/actor'
import { DEV_COOKIE, readCookie } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { changeOwnPassword, updateOwnProfile } from '@/server/domain/platform/admins'
import { adminAction } from '../_lib/action'
import { erroDeCampo, feito, ler, renomear } from '@/app/_lib/campos'
import type { EstadoCampos } from '@/app/_lib/campos'

export async function salvarPerfil(prev: EstadoCampos, fd: FormData): Promise<EstadoCampos> {
  return adminAction(
    (f) => ler(f, ['name']),
    (admin, v) => updateOwnProfile(admin, { name: v.name ?? '' }),
    (_r, v) => {
      revalidatePath('/dev', 'layout')
      return feito('Nome salvo.', v)
    },
  )(prev, fd)
}

/**
 * Troca a senha. O token da sessão atual vem do cookie, no servidor (nunca do formulário), para o domínio manter esta
 * sessão e revogar as outras. Os campos de senha começam com "senha": nunca voltam ao navegador.
 */
export async function trocarSenha(prev: EstadoCampos, fd: FormData): Promise<EstadoCampos> {
  return adminAction(
    (f) => ler(f, ['senhaAtual', 'senhaNova', 'senhaRepetida']),
    async (admin, v) => {
      if (v.senhaNova !== v.senhaRepetida) throw erroDeCampo('senhaRepetida', 'As duas senhas novas precisam ser iguais.')
      const token = await readCookie(DEV_COOKIE)
      if (!token) throw new DomainError('forbidden', 'Sua sessão acabou. Entre de novo para trocar a senha.')
      try {
        await changeOwnPassword(admin, { current: v.senhaAtual ?? '', next: v.senhaNova ?? '' }, token)
      } catch (err) {
        if (err instanceof AuthError) throw new DomainError('validation', err.message)
        throw renomear(err, { current: 'senhaAtual', next: 'senhaNova' })
      }
    },
    () => feito('Senha trocada. Os outros acessos foram encerrados.', {}),
  )(prev, fd)
}
