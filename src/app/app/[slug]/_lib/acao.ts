import 'server-only'
import { formError, type FormState } from '@/app/_lib/form-state'
import { requireCustomer } from '@/server/auth/guards'
import type { CustomerVisit } from '@/server/auth/customer-access'

/**
 * Monta uma ação de servidor da área do cliente. Ação é rota pública: ela chama `requireCustomer(slug, '/<slug>')` em TODA
 * execução, antes de ler o formulário (sem sessão, ou sem vínculo ativo com ESTA loja, o guarda redireciona e nada roda). Quem
 * age é sempre o cliente da sessão: nenhum id de cliente vem do formulário. `parse` só lê os campos; quem valida é o domínio.
 * O erro vira estado de formulário (`formError`); `redirect` e `notFound` lançados por `run` ou `done` passam adiante.
 */
export function clienteAction<V, R>(
  parse: (fd: FormData) => V,
  run: (v: CustomerVisit, values: V) => Promise<R>,
  done: (r: R, values: V, v: CustomerVisit) => FormState<V>,
): (slug: string, prev: FormState<V>, fd: FormData) => Promise<FormState<V>> {
  return async (slug, prev, fd) => {
    const visita = await requireCustomer(slug, `/${slug}`)
    let valores: V
    try {
      valores = parse(fd)
    } catch (err) {
      return formError(err, prev.values)
    }
    try {
      return done(await run(visita, valores), valores, visita)
    } catch (err) {
      return formError(err, valores)
    }
  }
}
