import type { RouteAuth, RouteDef } from './define-route'

/** A forma apagada de uma rota, como o registro a devolve. */
export type AnyRouteDef = RouteDef<RouteAuth, unknown, unknown, unknown, unknown>

// Guardado em `globalThis`: o recarregamento de módulos do desenvolvimento não pode perder o registro.
const GLOBAL_KEY = Symbol.for('agendaflui.api.routes')
type Holder = { [GLOBAL_KEY]?: Map<string, AnyRouteDef> }
const holder = globalThis as Holder
const routes: Map<string, AnyRouteDef> = (holder[GLOBAL_KEY] ??= new Map())

/** Registra a rota por método + caminho; registrar de novo o mesmo par substitui (o último ganha). */
export function registerRoute(def: AnyRouteDef): void {
  routes.set(`${def.method} ${def.path}`, def)
}

export function registeredRoutes(): readonly AnyRouteDef[] {
  return [...routes.values()]
}
