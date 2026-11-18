import type { TenantContext } from '@/server/auth/actor'
import type { TenantTx } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { TX_OPTIONS } from '@/server/domain/scheduling/placement'
import { deleteUploadRecord, ImageError, removeUploadFile, saveImage } from '@/server/storage/images'
import type { ImagePurpose } from '@/server/storage/images'

function fileAuthor(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'impersonator' || actor.kind === 'platform_admin') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

/**
 * Troca (ou, com `file: null`, remove) a imagem única de um registro (logo do parceiro, imagem do voucher). Grava a nova,
 * liga ao registro numa transação (`attach` devolve o id da imagem anterior) e só depois apaga a antiga; se a ligação falhar,
 * a nova é desfeita. O chamador já conferiu módulo, permissão e que o registro existe.
 */
export async function swapImage<R>(
  ctx: TenantContext,
  o: { file: { bytes: Uint8Array } | null; purpose: ImagePurpose; attach: (tx: TenantTx, uploadId: string | null) => Promise<{ row: R; previous: string | null }> },
): Promise<R> {
  const author = fileAuthor(ctx)
  let created: { id: string; path: string } | null = null
  if (o.file !== null) {
    try {
      created = await saveImage({ businessId: ctx.businessId, data: Buffer.from(o.file.bytes), purpose: o.purpose, createdBy: author })
    } catch (e) {
      if (e instanceof ImageError) throw new DomainError('validation', e.message, { fields: { file: e.message }, details: { imageCode: e.code } })
      throw e
    }
  }
  let result: { row: R; previous: string | null }
  try {
    result = await ctx.db.$transaction((tx) => o.attach(tx, created?.id ?? null), TX_OPTIONS)
  } catch (e) {
    if (created) {
      const path = await deleteUploadRecord(ctx.db, created.id).catch(() => null)
      if (path) await removeUploadFile(path)
    }
    throw e
  }
  if (result.previous !== null && result.previous !== created?.id) {
    const path = await deleteUploadRecord(ctx.db, result.previous)
    if (path !== null) await removeUploadFile(path)
  }
  return result.row
}
