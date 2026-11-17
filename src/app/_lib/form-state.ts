import { unstable_rethrow } from 'next/navigation'
import { DomainError } from '@/server/domain/errors'

/** Estado de um formulário dos painéis (dev e do negócio): o que a ação devolveu e o que a pessoa digitou. */
export type FormState<V> = { ok: boolean; message: string | null; fields: Record<string, string>; values: V }

export const MENSAGEM_GENERICA = 'Não foi possível concluir agora. Tente de novo em instantes; se continuar, avise quem cuida da plataforma.'
/** A mesma frase para quem usa o painel do negócio: quem cuida é o suporte do AgendaFlui. */
export const MENSAGEM_GENERICA_NEGOCIO = 'Não foi possível concluir agora. Tente de novo em instantes; se continuar, fale com o suporte do AgendaFlui.'

/** Nomes de campo que nunca voltam ao navegador: senhas, segredos, tokens e chaves. */
const SEGREDO = /senha|password|secret|segredo|token|apikey|api_key/i

/** Arquivos (File/Blob) enviados no formulário não voltam ao navegador: não são serializáveis e podem ser grandes. */
const ehArquivo = (v: unknown): boolean => typeof Blob !== 'undefined' && v instanceof Blob

function semSegredos(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(semSegredos)
  if (valor !== null && typeof valor === 'object' && Object.getPrototypeOf(valor) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([chave, v]) => !SEGREDO.test(chave) && !ehArquivo(v))
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
export function formError<V>(err: unknown, values: V, generica: string = MENSAGEM_GENERICA): FormState<V> {
  unstable_rethrow(err)
  const seguros = semSegredos(values) as V
  if (err instanceof DomainError) {
    return { ok: false, message: err.message, fields: { ...(err.fields ?? {}) }, values: seguros }
  }
  console.error(JSON.stringify({ level: 'error', event: 'form_action_failed', error: err instanceof Error ? err.name : 'unknown' }))
  return { ok: false, message: generica, fields: {}, values: seguros }
}
