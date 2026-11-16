import { z } from '@/server/domain/errors'
import { fromIsoInstant, isLocalDate, isMinuteLabel } from '@/server/time'

/*
 * Esquemas do formato de fio: descrevem o JSON que sai, e por isso viram JSON Schema (OpenAPI).
 * Use estes nos esquemas `response` das rotas, nunca `z.date()` nem `z.bigint()`.
 */

/** Instante em ISO 8601 UTC (`2027-01-15T08:00:00.000Z`), como `toIsoInstant` produz. */
export const isoInstant = z.iso.datetime()

/** Id de registro. */
export const uuid = z.uuid()

/** Instante enviado pelo app (`2027-01-15T13:00:00.000Z`): ISO 8601 UTC que de fato existe no calendário. Converta com `fromIsoInstant`. */
export const requestInstant = isoInstant.refine((texto) => {
  try {
    fromIsoInstant(texto)
    return true
  } catch {
    return false
  }
}, 'Informe um instante válido em ISO 8601 UTC, por exemplo 2027-01-15T13:00:00.000Z.').describe(
  'Instante em ISO 8601 UTC, sempre com o sufixo Z (por exemplo 2027-01-15T13:00:00.000Z); deslocamentos como -03:00 não são aceitos. Envie o instante exatamente como a API devolveu.',
)

/** Parâmetro de consulta lógico: só `true` ou `false` escritos por extenso. */
export const queryFlag = z.enum(['true', 'false'], 'Use true ou false.').transform((texto) => texto === 'true')

/** Data local da conta (`2027-01-15`), como o app a envia e a API a devolve. */
export const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use uma data no formato AAAA-MM-DD.')
  .refine(isLocalDate, 'Use uma data que exista, no formato AAAA-MM-DD.')
  .describe('Data local da conta, no formato AAAA-MM-DD.')

/** Hora local `HH:mm`, de 00:00 a 24:00 (o 24:00 só faz sentido como fim). */
export const hourLabel = z
  .string()
  .regex(/^\d{2}:\d{2}$/, 'Use a hora no formato HH:mm, por exemplo 09:00.')
  .refine(isMinuteLabel, 'Informe uma hora válida, de 00:00 a 24:00.')
  .describe('Hora local no formato HH:mm, de 00:00 a 24:00.')

/*
 * Parâmetros que se repetem entre rotas, já com a descrição que vai para o documento OpenAPI.
 */

/** Id de um registro na URL; `quem` completa a descrição ("o agendamento"). */
export const idParams = (quem: string) => z.object({ id: z.uuid().describe(`Id d${quem}.`) })

/** Escolha da lista de agendamentos de um cliente. */
export const listScope = z
  .enum(['upcoming', 'past'])
  .default('upcoming')
  .describe('`upcoming`: próximos, do mais perto ao mais longe. `past`: histórico, do mais recente ao mais antigo.')

export const pageCursor = z
  .string()
  .max(1024)
  .describe('Cursor da próxima página: o `nextCursor` da resposta anterior. Sem ele, vem a primeira página.')

/** Itens por página, de 1 a `max`; o domínio usa o seu padrão quando `fallback` não é dado. */
export const pageLimit = (max: number, fallback?: number) => {
  const base = z.coerce.number().int().min(1).max(max)
  return fallback === undefined
    ? base.optional().describe(`Itens por página, de 1 a ${max}.`)
    : base.default(fallback).describe(`Itens por página, de 1 a ${max} (padrão ${fallback}).`)
}

export const professionalIdQuery = z.string().max(64).describe('Id do profissional.')

/** Data local da conta (AAAA-MM-DD) na consulta; o domínio confere se existe. */
export const dateQuery = (descricao: string) => z.string().max(10).describe(descricao)
