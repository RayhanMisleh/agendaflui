'use server'
import { revalidatePath } from 'next/cache'
import { DomainError } from '@/server/domain/errors'
import { createAdmin, listAdmins, setAdminActive } from '@/server/domain/platform/admins'
import { adminAction } from '../_lib/action'
import { erroDeCampo, feito, ler, porAlvo, renomear } from '../_lib/campos'
import type { EstadoGlobal } from '../_lib/campos'

/** Cria um admin. A senha nunca volta no estado do formulário (o nome do campo começa com "senha"). */
export async function criarAdmin(prev: EstadoGlobal, fd: FormData): Promise<EstadoGlobal> {
  return adminAction(
    (f) => ler(f, ['name', 'email', 'senha']),
    async (admin, v) => {
      try {
        return await createAdmin(admin, { name: v.name ?? '', email: v.email ?? '', password: v.senha ?? '' })
      } catch (err) {
        throw renomear(err, { password: 'senha' })
      }
    },
    () => {
      revalidatePath('/dev/admins')
      return feito('Admin criado. Passe a senha por um canal seguro.', { name: '', email: '' })
    },
  )(prev, fd)
}

async function alvo(admin: Parameters<typeof listAdmins>[0], id: string) {
  const a = (await listAdmins(admin)).find((x) => x.id === id)
  if (!a) throw new DomainError('not_found', 'Admin não encontrado.')
  return a
}

/** Desativa um admin. Pede o nome dele; o domínio recusa desativar a si mesmo e o último admin ativo. */
export const desativarAdmin = porAlvo(
  ['confirmName'],
  async (admin, v, id) => {
    const a = await alvo(admin, id)
    if (v.confirmName !== a.name) throw erroDeCampo('confirmName', 'Digite o nome do admin exatamente como aparece, para confirmar.')
    await setAdminActive(admin, id, false)
  },
  (_r, v) => {
    revalidatePath('/dev/admins')
    return feito('Admin desativado.', { ...v, confirmName: '' })
  },
)

export const reativarAdmin = porAlvo(
  [],
  async (admin, _v, id) => {
    await setAdminActive(admin, id, true)
  },
  (_r, v) => {
    revalidatePath('/dev/admins')
    return feito('Admin reativado.', v)
  },
)
