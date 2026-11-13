import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: LucideIcon
  active?: boolean
  /** Módulo desligado ou tela ainda indisponível: aparece esmaecido e não é link. */
  disabled?: boolean
}
