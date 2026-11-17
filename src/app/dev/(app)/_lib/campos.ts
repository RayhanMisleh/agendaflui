import 'server-only'
import { DomainError } from '@/server/domain/errors'
import { adminAction } from './action'
import { porCodigo } from './params'
import type { PlatformAdminActor } from './action'
import type { FormState } from './form-state'

/** Campos de um formulário, em texto, como vêm do navegador. */
export type Campos = Record<string, string>
export type EstadoGlobal = FormState<Campos>

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
  return new DomainError(err.code, err.message, { fields, ...(err.reason ? { reason: err.reason } : {}) })
}

export function feito(mensagem: string, v: Campos, extra: Campos = {}): EstadoGlobal {
  return { ok: true, message: mensagem, fields: {}, values: { ...v, ...extra } }
}

/** Ação sobre um alvo escolhido na página: o id vem ligado no servidor (`acao.bind(null, id)`), nunca do formulário. */
export function porAlvo<R>(
  nomes: readonly string[],
  run: (admin: PlatformAdminActor, v: Campos, alvo: string) => Promise<R>,
  done: (r: R, v: Campos) => EstadoGlobal,
) {
  return (alvo: string, prev: EstadoGlobal, fd: FormData): Promise<EstadoGlobal> =>
    adminAction((f) => ler(f, nomes), (admin, v) => run(admin, v, alvo), done)(prev, fd)
}
