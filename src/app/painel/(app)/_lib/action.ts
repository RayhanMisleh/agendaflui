import 'server-only'
import type { TenantContext } from '@/server/auth/actor'
import { can } from '@/server/auth/capabilities'
import type { Capability } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { MENSAGEM_GENERICA_NEGOCIO, formError } from '@/app/_lib/form-state'
import type { FormState } from '@/app/_lib/form-state'

/**
 * Monta uma ação de servidor do painel do negócio. Ação é rota pública: ela chama `requireTenant()` em TODA execução,
 * antes de ler o formulário (sem sessão, o guarda redireciona e nada roda). Quem não tem a `capability` recebe "sem
 * permissão" como estado do formulário (e `run` não é chamado); `null` vale para qualquer membro. `parse` só lê os
 * campos; quem valida é o domínio, que confere a capacidade de novo. O erro vira estado de formulário (`formError`); o
 * sucesso devolve o estado de `done` ou redireciona (`redirect` e `notFound` lançados por `run` ou `done` passam adiante).
 * Com `capability: null` qualquer membro passa, e o suporte (impersonator) conta com todas as capacidades: quem protege
 * o dado é o domínio, que confere o papel de novo.
 */
export function tenantAction<V, R>(
  capability: Capability | null,
  parse: (fd: FormData) => V,
  run: (ctx: TenantContext, v: V) => Promise<R>,
  done: (r: R, v: V) => FormState<V>,
): (prev: FormState<V>, fd: FormData) => Promise<FormState<V>> {
  return async (prev, fd) => {
    const ctx = await requireTenant()
    if (capability !== null && !can(ctx.actor, capability)) {
      return formError(new DomainError('forbidden', 'Você não tem permissão para fazer isso.'), prev.values, MENSAGEM_GENERICA_NEGOCIO)
    }
    let valores: V
    try {
      valores = parse(fd)
    } catch (err) {
      return formError(err, prev.values, MENSAGEM_GENERICA_NEGOCIO)
    }
    try {
      return done(await run(ctx, valores), valores)
    } catch (err) {
      // `run` e `done` passam pelo mesmo tratamento: erro vira estado; `redirect` e `notFound` seguem adiante.
      return formError(err, valores, MENSAGEM_GENERICA_NEGOCIO)
    }
  }
}
