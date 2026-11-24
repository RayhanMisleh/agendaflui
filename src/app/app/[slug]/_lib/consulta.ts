import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { MENSAGEM_GENERICA } from '@/app/_lib/form-state'
import type { CustomerVisit } from '@/server/auth/customer-access'
import { readStoreVisit } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'

/** Resposta de uma consulta chamada pela tela (CEP, frete, horários): dado ou mensagem, nunca erro cru. */
export type Pedido<T> = ({ ok: true } & T) | { ok: false; message: string; reentrar: string | null }

/**
 * Roda uma consulta como cliente da loja. Visita que não é cliente (sessão acabou, conta desativada) devolve o caminho para
 * entrar de novo em vez de redirecionar, para a tela mostrar a mensagem sem perder o que a pessoa preencheu. Erro de domínio
 * vira a mensagem dele; qualquer outro vira a mensagem genérica (e só o nome do erro vai para o log).
 */
export async function consultar<T extends object>(slug: string, fn: (v: CustomerVisit) => Promise<T>): Promise<Pedido<T>> {
  const visita = await readStoreVisit(slug)
  if (visita.kind !== 'customer') return { ok: false, message: 'Entre de novo para continuar.', reentrar: `/${slug}/entrar` }
  try {
    return { ok: true, ...(await fn(visita)) }
  } catch (err) {
    unstable_rethrow(err)
    if (err instanceof DomainError) return { ok: false, message: err.message, reentrar: null }
    console.error(JSON.stringify({ level: 'error', event: 'consulta_failed', error: err instanceof Error ? err.name : 'unknown' }))
    return { ok: false, message: MENSAGEM_GENERICA, reentrar: null }
  }
}
