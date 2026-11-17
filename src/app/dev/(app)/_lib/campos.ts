import 'server-only'
import { adminAction } from './action'
import { ler } from '@/app/_lib/campos'
import type { Campos, EstadoCampos } from '@/app/_lib/campos'
import type { PlatformAdminActor } from './action'

/** Ação sobre um alvo escolhido na página: o id vem ligado no servidor (`acao.bind(null, id)`), nunca do formulário. */
export function porAlvo<R>(
  nomes: readonly string[],
  run: (admin: PlatformAdminActor, v: Campos, alvo: string) => Promise<R>,
  done: (r: R, v: Campos) => EstadoCampos,
) {
  return (alvo: string, prev: EstadoCampos, fd: FormData): Promise<EstadoCampos> =>
    adminAction((f) => ler(f, nomes), (admin, v) => run(admin, v, alvo), done)(prev, fd)
}
