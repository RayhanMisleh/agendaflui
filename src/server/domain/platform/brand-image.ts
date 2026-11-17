import 'server-only'
import type { TenantContext } from '@/server/auth/actor'
import { requireActiveAdmin } from '@/server/auth/platform-actor'
import { prisma } from '@/server/db/client'
import { Prisma } from '@/server/db/generated/client'
import { auditIn } from '@/server/domain/audit'
import { DomainError, orNotFound } from '@/server/domain/errors'
import { ImageError, removeUploadFile, saveImage, type ImagePurpose } from '@/server/storage/images'

export type BrandImageSlot = 'logo' | 'symbol' | 'favicon' | 'loginImage'

const SLOTS: Record<BrandImageSlot, { purpose: ImagePurpose; coluna: Prisma.Sql; campo: 'logoUploadId' | 'symbolUploadId' | 'faviconUploadId' | 'loginImageUploadId' }> = {
  logo: { purpose: 'logo', coluna: Prisma.raw('logo_upload_id'), campo: 'logoUploadId' },
  symbol: { purpose: 'symbol', coluna: Prisma.raw('symbol_upload_id'), campo: 'symbolUploadId' },
  favicon: { purpose: 'favicon', coluna: Prisma.raw('favicon_upload_id'), campo: 'faviconUploadId' },
  loginImage: { purpose: 'login', coluna: Prisma.raw('login_image_upload_id'), campo: 'loginImageUploadId' },
}

function erroDeImagem(slot: string, e: ImageError): DomainError {
  // `imageCode` deixa a tela dizer o motivo sem depender do texto da mensagem.
  return new DomainError('validation', e.message, { fields: { [slot]: e.message }, details: { imageCode: e.code } })
}

/** Remove o arquivo e o registro de uma imagem que saiu do ar. Falha vira log (sem texto do erro) e não desfaz nada. */
async function apagarImagem(businessId: string, slot: string, uploadId: string): Promise<void> {
  try {
    const up = await prisma.upload.findUnique({ where: { id: uploadId }, select: { path: true } })
    if (!up) return
    const { fileRemoved } = await removeUploadFile(up.path)
    // Arquivo que não saiu fica com o registro (sem vínculo), para a limpeza achar depois.
    if (fileRemoved) await prisma.upload.deleteMany({ where: { id: uploadId } })
    else console.error(JSON.stringify({ level: 'error', event: 'brand_image_cleanup_failed', businessId, slot, uploadId }))
  } catch {
    console.error(JSON.stringify({ level: 'error', event: 'brand_image_cleanup_failed', businessId, slot, uploadId }))
  }
}

function autorDoArquivo(ctx: TenantContext): { type: 'USER' | 'PLATFORM_ADMIN'; id: string | null } {
  const actor = ctx.actor
  if (actor.kind === 'member') return { type: 'USER', id: actor.userId }
  if (actor.kind === 'platform_admin' || actor.kind === 'impersonator') return { type: 'PLATFORM_ADMIN', id: actor.adminId }
  throw new DomainError('forbidden', 'Você não tem permissão para fazer isso.')
}

/**
 * Único caminho de troca (ou, com `file: null`, remoção) de uma imagem da marca: o admin do painel dev e o dono (logo)
 * passam por aqui; quem chama confere a permissão. Ordem: grava a nova, vincula na transação (com a linha da marca
 * travada, para duas trocas seguidas não deixarem imagem sem vínculo) e só depois apaga a antiga. O tipo vem dos bytes,
 * nunca do `mime` declarado. Se o vínculo falhar, a imagem nova é desfeita. Não mexe na versão da marca.
 */
export async function replaceBrandImage(ctx: TenantContext, slot: BrandImageSlot, file: { bytes: Uint8Array } | null): Promise<void> {
  const businessId = ctx.businessId
  // `hasOwn`: 'constructor' e '__proto__' existem em todo objeto e não são espaços.
  const s = Object.hasOwn(SLOTS, slot) ? SLOTS[slot] : undefined
  if (!s) throw new DomainError('validation', 'Escolha onde a imagem vai: logo, símbolo, favicon ou imagem de entrada.', { fields: { slot: 'Espaço de imagem desconhecido.' } })
  const autor = autorDoArquivo(ctx)

  orNotFound(await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }), 'Conta')
  let nova: { id: string; path: string } | null = null
  if (file !== null) {
    try {
      nova = await saveImage({ businessId, data: Buffer.from(file.bytes), purpose: s.purpose, createdBy: autor })
    } catch (e) {
      if (e instanceof ImageError) throw erroDeImagem(slot, e)
      throw e
    }
  }
  let antiga: string | null
  try {
    antiga = await prisma.$transaction(async (tx) => {
      if (ctx.actor.kind === 'platform_admin') await requireActiveAdmin(tx, ctx.actor)
      const linhas = await tx.$queryRaw<{ antiga: string | null }[]>(
        Prisma.sql`SELECT ${s.coluna} AS antiga FROM business_branding WHERE business_id = ${businessId}::uuid FOR UPDATE`,
      )
      const linha = linhas[0]
      if (!linha) throw new DomainError('not_found', 'Marca da conta não encontrada.')
      await tx.businessBranding.update({ where: { businessId }, data: { [s.campo]: nova?.id ?? null } })
      if (nova !== null || linha.antiga !== null) {
        await auditIn(tx, ctx, {
          action: 'brand.image_changed',
          targetType: 'business',
          targetId: businessId,
          metadata: { slot, change: nova === null ? 'removed' : linha.antiga === null ? 'added' : 'replaced' },
        })
      }
      return linha.antiga
    })
  } catch (e) {
    if (nova) await apagarImagem(businessId, slot, nova.id)
    throw e
  }
  if (antiga !== null) await apagarImagem(businessId, slot, antiga)
}
