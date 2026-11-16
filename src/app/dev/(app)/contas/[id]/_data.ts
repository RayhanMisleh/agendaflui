import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getBusinessDetail } from '@/server/domain/platform/businesses'
import type { BusinessDetail } from '@/server/domain/platform/businesses'
import type { PlatformAdminActor } from '../../_lib/action'

/** O admin e a conta da URL; conta inexistente (ou id que não é UUID) vira "não encontrada". */
export const carregarConta = cache(async (id: string): Promise<{ admin: PlatformAdminActor; conta: BusinessDetail }> => {
  const admin = await requirePlatformAdmin()
  try {
    return { admin, conta: await getBusinessDetail(admin, id) }
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
})
