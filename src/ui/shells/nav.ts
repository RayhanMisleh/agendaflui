import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  /** Rótulo curto para a barra do celular (cabe em ~5 caracteres por item); o completo vale na barra lateral. */
  shortLabel?: string
  icon: LucideIcon
  active?: boolean
  /** Módulo desligado ou tela ainda indisponível: aparece esmaecido e não é link. */
  disabled?: boolean
  /** Só vale para a rota exata (o início do painel não fica ativo nas subpáginas). */
  exact?: boolean
}

/** O destino está ativo na rota atual? A raiz e os destinos `exact` só valem para a própria rota; os outros valem também para as subpáginas. */
export function isNavActive(pathname: string, href: string, exact = false): boolean {
  if (exact || href === '/') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}
