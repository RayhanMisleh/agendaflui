import 'server-only'
import type { Actor } from '@/server/auth/actor'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { formError } from '@/app/_lib/form-state'
import type { FormState } from '@/app/_lib/form-state'

export type PlatformAdminActor = Extract<Actor, { kind: 'platform_admin' }>

/**
 * Monta uma ação de servidor do painel dev. Ação é rota pública: ela chama `requirePlatformAdmin()` em TODA execução,
 * antes de ler o formulário. `parse` só lê os campos; quem valida é o domínio. O erro vira estado de formulário
 * (`formError`); o sucesso devolve o estado de `done` ou redireciona (o `redirect` dentro de `done` passa adiante).
 */
export function adminAction<V, R>(
  parse: (fd: FormData) => V,
  run: (admin: PlatformAdminActor, v: V) => Promise<R>,
  done: (r: R, v: V) => FormState<V>,
): (prev: FormState<V>, fd: FormData) => Promise<FormState<V>> {
  return async (prev, fd) => {
    const admin = await requirePlatformAdmin()
    let valores: V
    try {
      valores = parse(fd)
    } catch (err) {
      return formError(err, prev.values)
    }
    let resultado: R
    try {
      resultado = await run(admin, valores)
    } catch (err) {
      return formError(err, valores)
    }
    return done(resultado, valores)
  }
}
