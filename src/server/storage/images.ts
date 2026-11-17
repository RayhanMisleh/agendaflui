import { randomUUID } from 'node:crypto'
import { areaLink } from '@/server/area-links'
import sharp, { type Metadata, type OutputInfo } from 'sharp'
import type { AuditActorType, Upload } from '@/server/db/generated/client'
import { tenantDb, type TenantClient, type TenantTx } from '@/server/db/tenant'
import { createPlatformUpload } from '@/server/db/uploads'
import { getStorage, type Storage } from './storage'

export type ImagePurpose = 'logo' | 'symbol' | 'favicon' | 'login' | 'avatar' | 'banner' | 'generic'

export type ImageErrorCode = 'too_large' | 'not_an_image' | 'unsupported_format' | 'too_many_pixels' | 'too_small'

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

/**
 * Limites de cada espaço de imagem. `w`/`h`: caixa máxima da saída (sem ampliar). `square`: recorta ao centro num quadrado
 * (o lado é o menor entre `w`, a largura e a altura da origem, ou exatamente `w` com `png`). `min`: menor lado aceito na origem.
 * `png`: sai PNG (favicon); os demais saem WebP.
 */
type Regra = { w: number; h: number; square: boolean; png?: boolean; min?: number }
export const REGRAS: Record<ImagePurpose, Regra> = {
  logo: { w: 1200, h: 600, square: false },
  symbol: { w: 512, h: 512, square: true, min: 64 },
  favicon: { w: 64, h: 64, square: true, png: true },
  login: { w: 2400, h: 2400, square: false },
  avatar: { w: 512, h: 512, square: true },
  banner: { w: 1920, h: 1080, square: false, min: 400 },
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

  // Só o cabeçalho é lido aqui (nenhum pixel é alocado), então o limite de pixels é conferido por nós, pelas dimensões,
  // e não pela mensagem de erro do `sharp`. A decodificação lá embaixo mantém o limite como segunda barreira.
  let meta: Metadata
  try {
    meta = await sharp(data, { limitInputPixels: false }).metadata()
  } catch {
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
  if (regra.min !== undefined && Math.min(w, h) < regra.min) {
    throw new ImageError('too_small', `A imagem é pequena demais (${w}x${h}). Envie uma imagem de pelo menos ${regra.min} x ${regra.min} pixels.`)
  }

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

/** URL absoluta (host da API) de um upload, para quem usa o app e não está no host do painel. `/arquivos/*` é servido em todos os hosts. */
export function publicUploadUrl(upload: { path: string } | null | undefined): string | null {
  return upload ? areaLink('api', `/arquivos/${upload.path}`) : null
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
