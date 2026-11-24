import type { FormState } from '@/app/_lib/form-state'

/** Estado de um formulário da área do cliente: campos em texto, como vêm do navegador. */
export type EstadoCliente = FormState<Record<string, string>>

export const ESTADO_VAZIO: EstadoCliente = { ok: false, message: null, fields: {}, values: {} }
