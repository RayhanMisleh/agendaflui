import type { z } from '@/server/domain/errors'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Caminho da primeira chave que está no JSON enviado e não sobreviveu ao esquema (o Zod remove as desconhecidas). */
function extraKeyPath(sent: unknown, parsed: unknown, path: string): string | null {
  if (Array.isArray(sent) && Array.isArray(parsed)) {
    for (let i = 0; i < sent.length && i < parsed.length; i++) {
      const achado = extraKeyPath(sent[i], parsed[i], path === '' ? String(i) : `${path}.${i}`)
      if (achado !== null) return achado
    }
    return null
  }
  if (isRecord(sent) && isRecord(parsed)) {
    for (const [chave, valor] of Object.entries(sent)) {
      const caminho = path === '' ? chave : `${path}.${chave}`
      if (!Object.hasOwn(parsed, chave)) return caminho
      const achado = extraKeyPath(valor, parsed[chave], caminho)
      if (achado !== null) return achado
    }
  }
  return null
}

/**
 * Confere o JSON de saída contra o esquema `response` de forma ESTRITA: tipo errado ou campo fora do contrato
 * (em qualquer nível) é problema. Devolve a descrição do problema ou `null`. Não exige `z.strictObject` do autor da rota.
 */
export async function checkWireContract(schema: z.ZodType, json: unknown): Promise<string | null> {
  const r = await schema.safeParseAsync(json)
  if (!r.success) return r.error.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`).join('; ')
  const extra = extraKeyPath(json, r.data, '')
  return extra === null ? null : `campo fora do contrato em "${extra}"`
}
