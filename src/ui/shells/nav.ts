import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  active?: boolean
  /** Módulo desligado ou tela ainda indisponível: aparece esmaecido e não é link. */
  disabled?: boolean
}

/** O destino está ativo na rota atual? A raiz só vale para ela mesma; os outros valem também para as subpáginas. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
