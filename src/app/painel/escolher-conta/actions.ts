'use server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AuthError } from '@/server/auth/actor'
import { PAINEL_COOKIE, readCookie, requireMemberSession, setBrandCookie } from '@/server/auth/guards'
import { selectBusiness } from '@/server/auth/member-auth'

const idSchema = z.uuid()

/** Define a conta ativa da sessão. Só aceita contas de que a pessoa é membro ativo. */
export async function chooseBusiness(form: FormData): Promise<void> {
  const session = await requireMemberSession()
  // Suporte não escolhe conta: a conta é a da sessão.
  if (session.kind === 'support') redirect('/')
  const token = await readCookie(PAINEL_COOKIE)
  const id = idSchema.safeParse(form.get('businessId'))
  const vinculo = id.success ? session.memberships.find((m) => m.businessId === id.data) : undefined
  if (!token || !id.success || !vinculo) redirect('/escolher-conta')
  try {
    await selectBusiness(token, id.data)
  } catch (erro) {
    if (!(erro instanceof AuthError)) throw erro
    redirect('/escolher-conta')
  }
  await setBrandCookie(vinculo.slug)
  redirect('/')
}
