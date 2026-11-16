import { toIsoInstant } from '@/server/time'

const MAX_DEPTH = 40
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER)

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function nomeDe(value: object): string {
  return value.constructor?.name || 'objeto sem nome'
}

function convert(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`Não é possível serializar um número que não é finito em "${path}".`)
      return value
    case 'bigint':
      return value >= MIN_SAFE && value <= MAX_SAFE ? Number(value) : value.toString()
    case 'object':
      break
    default:
      throw new Error(`Não é possível serializar ${typeof value} em "${path}".`)
  }
  if (value instanceof Date) return toIsoInstant(value)
  if (seen.has(value) || seen.size > MAX_DEPTH) {
    throw new Error(`Não é possível serializar uma referência circular (ou funda demais) em "${path}".`)
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item, i) => (item === undefined ? null : convert(item, `${path}[${i}]`, seen)))
    }
    if (!isPlainObject(value)) {
      throw new Error(
        `Não é possível serializar ${nomeDe(value)} em "${path}". Devolva objetos simples, sem Map, Set nem classes (modelos do Prisma incluídos).`,
      )
    }
    const out: Record<string, unknown> = {}
    for (const [chave, item] of Object.entries(value)) {
      if (item === undefined) continue
      out[chave] = convert(item, path === '' ? chave : `${path}.${chave}`, seen)
    }
    return out
  } finally {
    seen.delete(value)
  }
}

/**
 * Converte o retorno de uma rota em JSON puro: `Date` vira ISO UTC, `bigint` vira número (ou texto se passar
 * do limite seguro), `undefined` some dos objetos. `Map`, `Set`, classes e referências circulares são erro de programação.
 */
export function toJson(value: unknown): unknown {
  return convert(value, '', new Set())
}
