import { APP_COOKIE } from '@/server/auth/guards'
import { loginWithPassword } from '@/server/auth/session'
import { prisma } from '@/server/db/client'
import { makeUser } from './factories'

const SENHA = 'senha-bem-longa'

/**
 * Liga o cadastro a uma pessoa nova (com senha), entra com ela e põe o cookie da sessão no `jar` de quem testa ações da área
 * do cliente. Devolve a pessoa.
 */
export async function entrarComoCliente(jar: Map<string, string>, businessId: string, customerId: string) {
  const u = await makeUser({ password: SENHA })
  await prisma.customer.update({ where: { id: customerId }, data: { userId: u.id, email: u.email, linkedAt: new Date() } })
  const sessao = await loginWithPassword({ email: u.email, password: SENHA, customerBusinessId: businessId }, new Date())
  jar.set(APP_COOKIE, sessao.token)
  return u
}

export function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}
