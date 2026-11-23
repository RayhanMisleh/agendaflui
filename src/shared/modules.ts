/** Os módulos opcionais da conta (da Fase 5 em diante); desligados por padrão. */
export const MODULE_NAMES = ['loyalty', 'banners', 'store'] as const
export type ModuleName = (typeof MODULE_NAMES)[number]
export type Modules = Record<ModuleName, boolean>

export const MODULE_LABELS: Record<ModuleName, string> = {
  loyalty: 'Fidelidade',
  banners: 'Banners',
  store: 'Loja',
}
