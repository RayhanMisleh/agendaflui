import 'server-only'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { env } from '@/server/env'

/**
 * Cifra dos segredos de integração (tokens do Mercado Pago e da Frenet) em repouso: AES-256-GCM com iv aleatório de
 * 12 bytes por selo e o `aad` (conta + provedor + campo) autenticado junto, então um selo copiado para outra conta ou
 * outro campo não abre. A chave vem do APP_SECRET por HKDF com rótulo próprio, calculada uma vez.
 *
 * Formato: `v1.<iv>.<cifra>.<tag>`, cada parte em base64url.
 */
export class SecretBoxError extends Error {
  constructor(message = 'Não foi possível abrir o segredo cifrado.') {
    super(message)
    this.name = 'SecretBoxError'
  }
}

const VERSAO = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

let chave: Buffer | undefined

function boxKey(): Buffer {
  chave ??= Buffer.from(hkdfSync('sha256', env.APP_SECRET, '', 'agendaflui/integration-secrets/v1', 32))
  return chave
}

/** Decodifica base64url exigindo a forma canônica: um caractere trocado nunca "decodifica igual" por sobra de bits. */
function decodificar(parte: string): Buffer {
  const bytes = Buffer.from(parte, 'base64url')
  if (bytes.toString('base64url') !== parte) throw new SecretBoxError()
  return bytes
}

/** Cifra `plain` para o `aad` dado. O selo nunca contém o texto puro. */
export function sealSecret(plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const cifra = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSAO, iv.toString('base64url'), cifra.toString('base64url'), tag.toString('base64url')].join('.')
}

/** Abre um selo. `SecretBoxError` se o selo foi alterado, veio de outra chave ou foi feito para outro `aad`. */
export function openSecret(sealed: string, aad: string): string {
  try {
    const partes = sealed.split('.')
    if (partes.length !== 4 || partes[0] !== VERSAO) throw new SecretBoxError()
    const [, ivTexto, cifraTexto, tagTexto] = partes as [string, string, string, string]
    const iv = decodificar(ivTexto)
    const cifra = decodificar(cifraTexto)
    const tag = decodificar(tagTexto)
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretBoxError()
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), iv, { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(cifra), decipher.final()]).toString('utf8')
  } catch (err) {
    // Nenhuma mensagem do `crypto` (nem o selo, nem o aad) sobe: só o tipo do erro.
    throw err instanceof SecretBoxError ? err : new SecretBoxError()
  }
}

/** Os 4 últimos caracteres, a única parte de um segredo que telas e auditoria podem mostrar. */
export function lastFour(plain: string): string {
  return plain.slice(-4)
}
