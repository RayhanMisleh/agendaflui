import 'server-only'
import { prisma } from '@/server/db/client'
import { uploadUrl } from '@/server/storage/images'
import { isUuid } from './context'

export type PublicUser = { name: string; email: string; avatarUrl: string | null }

/**
 * Nome, e-mail e foto dos usuários pedidos, só dos que têm vínculo (ativo ou não) NA conta indicada: um id de usuário de
 * outra conta, ou sem vínculo, simplesmente não aparece. É a única leitura de `users` que o painel faz para exibir a equipe;
 * nunca devolve senha, convite nem sessão. A foto sai pelo mesmo ajudante de URL de upload que o painel usa.
 */
export async function publicUsers(businessId: string, userIds: string[]): Promise<Map<string, PublicUser>> {
  const ids = [...new Set(userIds.filter(isUuid))]
  if (ids.length === 0 || !isUuid(businessId)) return new Map()
  const linhas = await prisma.user.findMany({
    where: { id: { in: ids }, memberships: { some: { businessId } } },
    select: { id: true, name: true, email: true, avatar: { select: { path: true } } },
  })
  return new Map(linhas.map((u) => [u.id, { name: u.name, email: u.email, avatarUrl: uploadUrl(u.avatar) }]))
}
