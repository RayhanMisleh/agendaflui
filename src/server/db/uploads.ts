import type { Prisma, Upload } from './generated/client'
import { prisma } from './client'

/**
 * Grava um upload da plataforma (sem conta). Uploads de conta passam por `tenantDb`.
 * É a única gravação com o cliente cru fora de `tenantDb` para esse modelo.
 */
export function createPlatformUpload(data: Omit<Prisma.UploadUncheckedCreateInput, 'businessId'>): Promise<Upload> {
  return prisma.upload.create({ data: { ...data, businessId: null } })
}
