import { z } from '@/server/domain/errors'

/*
 * Esquemas do formato de fio: descrevem o JSON que sai, e por isso viram JSON Schema (OpenAPI).
 * Use estes nos esquemas `response` das rotas, nunca `z.date()` nem `z.bigint()`.
 */

/** Instante em ISO 8601 UTC (`2027-01-15T08:00:00.000Z`), como `toIsoInstant` produz. */
export const isoInstant = z.iso.datetime()

/** Id de registro. */
export const uuid = z.uuid()
