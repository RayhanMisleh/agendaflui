import { randomUUID } from 'node:crypto'
import sharp, { type Metadata, type OutputInfo } from 'sharp'
import type { AuditActorType, Upload } from '@/server/db/generated/client'
import { tenantDb, type TenantClient, type TenantTx } from '@/server/db/tenant'
import { createPlatformUpload } from '@/server/db/uploads'
import { getStorage, type Storage } from './storage'

export type ImagePurpose = 'logo' | 'symbol' | 'favicon' | 'login' | 'avatar' | 'generic'

export type ImageErrorCode = 'too_large' | 'not_an_image' | 'unsupported_format' | 'too_many_pixels'

export class ImageError extends Error {
  readonly code: ImageErrorCode
  constructor(code: ImageErrorCode, message: string) {
    super(message)
    this.name = 'ImageError'
    this.code = code
  }
}

const MAX_BYTES = 8 * 1024 * 1024
const MAX_PIXELS = 40_000_000
const FORMATOS = new Set(['jpeg', 'png', 'webp'])

type Regra = { w: number; h: number; square: boolean; png?: boolean }
const REGRAS: Record<ImagePurpose, Regra> = {
  logo: { w: 800, h: 400, square: false },
  symbol: { w: 512, h: 512, square: true },
  favicon: { w: 96, h: 96, square: true, png: true },
  login: { w: 2000, h: 2000, square: false },
  avatar: { w: 512, h: 512, square: true },
  generic: { w: 1600, h: 1600, square: false },
}

function erroDePixels(): ImageError {
  return new ImageError('too_many_pixels', 'A imagem tem pixels demais (mais de 40 megapixels). Reduza a imagem e envie de novo.')
}

export interface SaveImageInput {
  businessId: string | null
  data: Buffer
  purpose: ImagePurpose
  createdBy: { type: AuditActorType; id: string | null }
}

export async function saveImage(input: SaveImageInput, storage: Storage = getStorage()): Promise<Upload> {
  const { businessId, data, purpose, createdBy } = input
  if (data.length > MAX_BYTES) {
    throw new ImageError('too_large', 'A imagem passa de 8 MB. Envie um arquivo menor.')
  }

  let meta: Metadata
  try {
    meta = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata()
  } catch (erro) {
    if (erro instanceof Error && erro.message.includes('pixel limit')) throw erroDePixels()
    throw new ImageError('not_an_image', 'O arquivo não é uma imagem. Envie uma imagem JPEG, PNG ou WebP.')
  }
  if (!meta.format || !FORMATOS.has(meta.format)) {
    throw new ImageError('unsupported_format', 'Esse formato de imagem não é aceito. Envie uma imagem JPEG, PNG ou WebP.')
  }
  const largura = meta.width ?? 0
  const altura = meta.height ?? 0
  if (largura <= 0 || altura <= 0) {
    throw new ImageError('not_an_image', 'O arquivo não é uma imagem. Envie uma imagem JPEG, PNG ou WebP.')
  }
  if (largura * altura > MAX_PIXELS) {
    throw erroDePixels()
  }

  const regra = REGRAS[purpose]
  // Orientação EXIF 5 a 8 troca largura e altura depois de girar.
  const girada = (meta.orientation ?? 1) >= 5
  const w = girada ? altura : largura
  const h = girada ? largura : altura

  // Só o primeiro quadro (imagem animada): sharp lê a página 0 por padrão.
  let pipeline = sharp(data, { limitInputPixels: MAX_PIXELS }).rotate()
  if (regra.square) {
    const lado = regra.png ? regra.w : Math.min(regra.w, w, h)
    pipeline = pipeline.resize(lado, lado, { fit: 'cover', position: 'centre' })
  } else {
    pipeline = pipeline.resize(regra.w, regra.h, { fit: 'inside', withoutEnlargement: true })
  }

  let saida: { data: Buffer; info: OutputInfo }
  try {
    pipeline = regra.png ? pipeline.png() : pipeline.webp({ quality: 85 })
    saida = await pipeline.toBuffer({ resolveWithObject: true })
  } catch {
    throw new ImageError('not_an_image', 'Não foi possível ler a imagem. Envie outro arquivo JPEG, PNG ou WebP.')
  }

  const ext = regra.png ? 'png' : 'webp'
  const mimeType = regra.png ? 'image/png' : 'image/webp'
  const path = `${businessId ?? 'platform'}/${randomUUID()}.${ext}`

  await storage.put(path, saida.data, mimeType)
  const registro = {
    path,
    mimeType,
    sizeBytes: saida.data.length,
    width: saida.info.width,
    height: saida.info.height,
    createdByType: createdBy.type,
    createdById: createdBy.id,
  }
  try {
    return businessId === null
      ? await createPlatformUpload(registro)
      : await tenantDb(businessId).upload.create({ data: registro })
  } catch (erro) {
    await storage.delete(path).catch(() => undefined)
    throw erro
  }
}

export function uploadUrl(upload: { path: string } | null | undefined): string | null {
  return upload ? `/arquivos/${upload.path}` : null
}

/** Apaga só o registro (da conta do cliente `db`); devolve o caminho do arquivo, ou `null` se não havia registro. */
export async function deleteUploadRecord(db: TenantClient | TenantTx, uploadId: string): Promise<string | null> {
  const upload = await db.upload.findUnique({ where: { id: uploadId }, select: { path: true } })
  if (!upload) return null
  await db.upload.deleteMany({ where: { id: uploadId } })
  return upload.path
}

/** Remove o arquivo do storage. Não lança: a falha volta como `fileRemoved: false` para quem chamou registrar. */
export async function removeUploadFile(path: string, storage: Storage = getStorage()): Promise<{ fileRemoved: boolean }> {
  try {
    await storage.delete(path)
    return { fileRemoved: true }
  } catch {
    return { fileRemoved: false }
  }
}
