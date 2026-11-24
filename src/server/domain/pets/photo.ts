import type { TenantContext } from '@/server/auth/actor'
import { audit } from '@/server/domain/audit'
import { authorize, DomainError, orNotFound, z } from '@/server/domain/errors'
import { requirePetNiche } from '@/server/domain/settings/niche-settings'
import { ImageError, deleteUploadRecord, removeUploadFile, saveImage } from '@/server/storage/images'

function autorDoArquivo(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN' | 'SYSTEM'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'impersonator' || actor.kind === 'platform_admin') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  if (actor.kind === 'customer') return { type: 'SYSTEM', id: actor.customerId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

/**
 * Troca (ou, com `image: null`, remove) a foto de um pet. A equipe com `manage_clients` troca a de qualquer pet; o cliente,
 * só a dos próprios (de outro cliente: `not_found`). O tipo vem dos bytes. Grava a nova, liga ao pet numa transação e só
 * depois apaga a antiga; se a ligação falhar, a nova é desfeita.
 */
export async function setPetPhoto(ctx: TenantContext, petId: string, image: { bytes: Uint8Array } | null): Promise<void> {
  if (ctx.actor.kind !== 'customer') authorize(ctx, 'manage_clients')
  await requirePetNiche(ctx)
  if (!z.uuid().safeParse(petId).success) throw new DomainError('not_found', 'Pet não encontrado.')
  const pet = orNotFound(await ctx.db.pet.findUnique({ where: { id: petId }, select: { customerId: true } }), 'Pet')
  if (ctx.actor.kind === 'customer' && ctx.actor.customerId !== pet.customerId) throw new DomainError('not_found', 'Pet não encontrado.')
  const autor = autorDoArquivo(ctx)
  let nova: { id: string; path: string } | null = null
  if (image !== null) {
    try {
      nova = await saveImage({ businessId: ctx.businessId, data: Buffer.from(image.bytes), purpose: 'avatar', createdBy: autor })
    } catch (e) {
      if (e instanceof ImageError) {
        throw new DomainError('validation', e.message, { fields: { file: e.message }, details: { imageCode: e.code } })
      }
      throw e
    }
  }
  let antiga: string | null = null
  try {
    antiga = await ctx.db.$transaction(async (tx) => {
      // Duas trocas ao mesmo tempo se enfileiram: a segunda lê a foto que a primeira deixou e apaga a antiga certa.
      await tx.$lockKey('customer', pet.customerId)
      const atual = orNotFound(await tx.pet.findUnique({ where: { id: petId }, select: { photoUploadId: true } }), 'Pet')
      await tx.pet.update({ where: { id: petId }, data: { photoUploadId: nova?.id ?? null } })
      await audit(
        ctx,
        { action: 'pet.photo_changed', targetType: 'Pet', targetId: petId, metadata: { change: nova === null ? 'removed' : atual.photoUploadId === null ? 'added' : 'replaced' } },
        tx,
      )
      return atual.photoUploadId
    })
  } catch (e) {
    if (nova) {
      const caminho = await deleteUploadRecord(ctx.db, nova.id).catch(() => null)
      if (caminho) await removeUploadFile(caminho)
    }
    throw e
  }
  if (antiga !== null && antiga !== nova?.id) {
    const caminho = await deleteUploadRecord(ctx.db, antiga)
    if (caminho !== null) await removeUploadFile(caminho)
  }
}
