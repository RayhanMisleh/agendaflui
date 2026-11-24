import 'server-only'
import { DomainError } from '@/server/domain/errors'
import { porCodigo } from './params'
import type { FormState } from './form-state'

/** Campos de um formulário, em texto, como vêm do navegador. */
export type Campos = Record<string, string>
/** Estado de um formulário de campos em texto (o mais comum nos dois painéis). */
export type EstadoCampos = FormState<Campos>

/** Lê os campos nomeados como texto; caixa de marcar vira `'on'` ou `''`; arquivo e campo ausente viram `''`. */
export function ler(fd: FormData, nomes: readonly string[], caixas: readonly string[] = []): Campos {
  const v: Campos = {}
  for (const n of nomes) {
    const x = fd.get(n)
    v[n] = typeof x === 'string' ? x : ''
  }
  for (const n of caixas) v[n] = fd.has(n) ? 'on' : ''
  return v
}

/** Uma linha por item, sem linhas vazias. */
export function linhasDe(texto: string): string[] {
  return texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
}

export function erroDeCampo(campo: string, mensagem: string): DomainError {
  return new DomainError('validation', mensagem, { fields: { [campo]: mensagem } })
}

/** Troca o nome de campo do domínio pelo do formulário: vale o nome inteiro (`owner.email`) ou só o começo (`origens.0` → `origens`). */
export function renomear(err: unknown, mapa: Record<string, string>): unknown {
  if (!(err instanceof DomainError) || !err.fields) return err
  const nome = (k: string): string => (Object.hasOwn(mapa, k) ? mapa[k] : undefined) ?? porCodigo(mapa, k.split('.')[0] ?? k) ?? k
  const fields = Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [nome(k), m]))
  return new DomainError(err.code, err.message, { fields, ...(err.reason ? { reason: err.reason } : {}), ...(err.details ? { details: err.details } : {}) })
}

export function feito(mensagem: string, v: Campos, extra: Campos = {}): EstadoCampos {
  return { ok: true, message: mensagem, fields: {}, values: { ...v, ...extra } }
}

/** O convite foi gerado, mas o e-mail não saiu: aviso (não é sucesso) com o que fazer, para o botão de reenviar ficar à mão. */
export function conviteNaoEnviado(v: Campos): EstadoCampos {
  return {
    ok: false,
    message: 'Convite não enviado. O cadastro ficou salvo, mas o e-mail não saiu. Confira o endereço e reenvie o convite.',
    fields: {},
    values: v,
  }
}
