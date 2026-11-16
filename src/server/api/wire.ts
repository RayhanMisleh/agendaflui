import { z } from '@/server/domain/errors'
import { fromIsoInstant } from '@/server/time'

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
