import { unstable_rethrow } from 'next/navigation'
import { DomainError } from '@/server/domain/errors'

/** Estado de um formulário do painel dev: o que a ação devolveu e o que a pessoa digitou. */
export type FormState<V> = { ok: boolean; message: string | null; fields: Record<string, string>; values: V }

export const MENSAGEM_GENERICA = 'Não foi possível concluir agora. Tente de novo em instantes; se continuar, avise quem cuida da plataforma.'

/** Nomes de campo que nunca voltam ao navegador: senhas, segredos, tokens e chaves. */
const SEGREDO = /senha|password|secret|segredo|token|apikey|api_key/i

function semSegredos(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semSegredos)
  if (valor !== null && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([chave]) => !SEGREDO.test(chave))
        .map(([chave, v]) => [chave, semSegredos(v)]),
    )
  }
  return valor
}

/**
 * Transforma o erro de uma ação em estado de formulário. `DomainError` vira mensagem e campos; qualquer outro erro vira
 * a mensagem genérica e só o NOME do erro vai para o log (o texto pode trazer endereço, senha ou SQL). Redirecionamento
 * e "não encontrado" do Next passam adiante. Os valores voltam sem senha nem segredo.
 */
export function formError<V>(err: unknown, values: V): FormState<V> {
  unstable_rethrow(err)
  const seguros = semSegredos(values) as V
  if (err instanceof DomainError) {
    return { ok: false, message: err.message, fields: { ...(err.fields ?? {}) }, values: seguros }
  }
  console.error(JSON.stringify({ level: 'error', event: 'dev_action_failed', error: err instanceof Error ? err.name : 'unknown' }))
  return { ok: false, message: MENSAGEM_GENERICA, fields: {}, values: seguros }
}
