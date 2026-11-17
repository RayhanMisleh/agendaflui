import type { TenantContext } from '@/server/auth/actor'
import { audit } from '@/server/domain/audit'
import { DomainError, orNotFound } from '@/server/domain/errors'
import { assertCanWriteSchedule } from '@/server/domain/team/professionals'
import { ImageError, deleteUploadRecord, removeUploadFile, saveImage } from '@/server/storage/images'

function autorDoArquivo(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'impersonator' || actor.kind === 'platform_admin') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

/**
 * Troca (ou, com `file: null`, remove) a foto de um profissional. Quem gerencia a equipe troca a de qualquer um; o
 * profissional, só a própria. O tipo vem dos bytes (nunca do tipo declarado). Grava a nova, liga à ficha numa transação
 * e só depois apaga a antiga; se a ligação falhar, a nova é desfeita.
 */
export async function setProfessionalAvatar(ctx: TenantContext, professionalId: string, file: { bytes: Uint8Array } | null): Promise<void> {
  await assertCanWriteSchedule(ctx, professionalId)
  const autor = autorDoArquivo(ctx)
  let nova: { id: string; path: string } | null = null
  if (file !== null) {
    try {
      nova = await saveImage({ businessId: ctx.businessId, data: Buffer.from(file.bytes), purpose: 'avatar', createdBy: autor })
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
      const atual = orNotFound(await tx.professional.findUnique({ where: { id: professionalId }, select: { avatarUploadId: true } }), 'Profissional')
      await tx.professional.update({ where: { id: professionalId }, data: { avatarUploadId: nova?.id ?? null } })
      await audit(ctx, { action: 'professional.avatar_changed', targetType: 'Professional', targetId: professionalId, metadata: { change: nova === null ? 'removed' : atual.avatarUploadId === null ? 'added' : 'replaced' } }, tx)
      return atual.avatarUploadId
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
