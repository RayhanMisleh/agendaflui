import type { RouteDef } from './define-route'

export type AnyRouteDef = RouteDef<unknown, unknown, unknown, unknown>

type Entry = { def: AnyRouteDef; source: string | null }

// Guardado em `globalThis`: o recarregamento de módulos do desenvolvimento não pode perder o registro.
const GLOBAL_KEY = Symbol.for('agendaflui.api.routes')
type Holder = { [GLOBAL_KEY]?: Map<string, Entry> }
const holder = globalThis as Holder
const routes: Map<string, Entry> = (holder[GLOBAL_KEY] ??= new Map())

/**
 * Registra a rota (método + caminho). Registrar de novo a mesma rota vinda do mesmo arquivo (recarga a quente,
 * importação dupla) substitui sem erro; a mesma rota vinda de OUTRO arquivo com definição diferente lança.
 * `source` desconhecida (`null`) sempre substitui.
 */
export function registerRoute(def: AnyRouteDef, source: string | null = null): void {
  const chave = `${def.method} ${def.path}`
  const atual = routes.get(chave)
  if (atual && source !== null && atual.source !== null && atual.source !== source) {
    throw new Error(`A rota ${chave} já foi definida em outro arquivo (${atual.source}). Cada método e caminho tem uma só definição.`)
  }
  routes.set(chave, { def, source })
}

export function registeredRoutes(): readonly AnyRouteDef[] {
  return [...routes.values()].map((e) => e.def)
}
