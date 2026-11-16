import { DomainError } from '@/server/domain/errors'

/**
 * Troca de nome de campo: `[de, para]`. `de` que começa com ponto vale como sufixo (`.endMin` → `.end` serve para
 * `MONDAY.0.endMin`); os demais valem só para o nome inteiro.
 */
export type FieldRename = readonly [from: string, to: string]

function renameKey(key: string, renames: readonly FieldRename[]): string {
  for (const [from, to] of renames) {
    if (from.startsWith('.') ? key.endsWith(from) : key === from) {
      return from.startsWith('.') ? `${key.slice(0, key.length - from.length)}${to}` : to
    }
  }
  return key
}

/**
 * Roda a chamada de domínio e, se ela falhar com erro de validação, devolve `fields` com os nomes que o app envia
 * (o domínio fala em minutos e em `startsAt`/`endsAt`; o corpo da rota fala em `HH:mm`). Só renomeia chaves; a regra
 * continua toda no domínio. Outros erros passam como estão.
 */
export async function withFieldNames<T>(renames: readonly FieldRename[], work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (err instanceof DomainError && err.code === 'validation' && err.fields) {
      const fields = Object.fromEntries(Object.entries(err.fields).map(([key, message]) => [renameKey(key, renames), message]))
      throw new DomainError(err.code, err.message, {
        fields,
        ...(err.reason !== undefined ? { reason: err.reason } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      })
    }
    throw err
  }
}
