import { hash, verify } from '@node-rs/argon2'
import { z } from 'zod'

export const passwordSchema = z
  .string()
  .min(10, 'A senha precisa ter pelo menos 10 caracteres.')
  .max(200, 'A senha pode ter no máximo 200 caracteres.')

// Variante argon2id e custo: padrões recomendados pela biblioteca.
export function hashPassword(plain: string): Promise<string> {
  return hash(plain)
}

/** Hash de uma senha qualquer, para gastar o mesmo tempo quando o usuário não existe (calculado uma vez, na carga). */
export const fakePasswordHash: Promise<string> = hashPassword('senha-falsa-para-igualar-o-tempo')

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain)
  } catch {
    return false
  }
}
