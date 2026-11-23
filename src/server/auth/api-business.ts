import 'server-only'
import { prisma } from '@/server/db/client'
import { ApiAuthError } from './api-auth-error'

/** A conta de uma requisição da API, lida do cabeçalho `X-Business`. */
export type ApiBusiness = { id: string; slug: string; timeZone: string }

const SLUG_MAX = 100

/**
 * Resolve a conta pelo `slug` do cabeçalho `X-Business`. Cabeçalho ausente ou conta inexistente: 401 `unknown_business`
 * (a mesma resposta nos dois casos). Conta suspensa ou arquivada: 503 `business_unavailable`.
 */
export async function resolveApiBusiness(slugHeader: string | null): Promise<ApiBusiness> {
  const slug = slugHeader?.trim().toLowerCase() ?? ''
  const conta =
    slug === '' || slug.length > SLUG_MAX
      ? null
      : await prisma.business.findUnique({ where: { slug }, select: { id: true, slug: true, timezone: true, status: true } })
  if (!conta) throw new ApiAuthError('unauthorized', 'unknown_business', 'Conta não encontrada. Confira o endereço da conta.')
  if (conta.status !== 'ACTIVE') {
    throw new ApiAuthError('business_unavailable', 'business_unavailable', 'Esta conta não está disponível agora. Fale com o suporte.')
  }
  return { id: conta.id, slug: conta.slug, timeZone: conta.timezone }
}
