import { CalendarClock, CalendarPlus, Ellipsis, Gift, House, PawPrint, ShoppingBag, UserRound, type LucideIcon } from 'lucide-react'
import type { Modules } from '@/shared/modules'
import { isNavActive, type NavItem } from './nav'

/**
 * Navegação da área do cliente: Início, Agendar, Horários, Pets (só loja de pet shop) e Mais. `pathname` é o endereço
 * atual (com a loja): o item ativo sai dele. "Mais" também vale para as telas que moram nele (Prêmios e Loja).
 */
export function clienteNav(slug: string, i: { pets: boolean }, pathname: string): NavItem[] {
  const base = `/${slug}`
  const emMais = ['mais', 'premios', 'loja'].some((p) => isNavActive(pathname, `${base}/${p}`))
  const itens: NavItem[] = [
    { href: base, label: 'Início', shortLabel: 'Início', icon: House, exact: true, active: isNavActive(pathname, base, true) },
    { href: `${base}/agendar`, label: 'Agendar', shortLabel: 'Agendar', icon: CalendarPlus, active: isNavActive(pathname, `${base}/agendar`) },
    { href: `${base}/horarios`, label: 'Horários', shortLabel: 'Horários', icon: CalendarClock, active: isNavActive(pathname, `${base}/horarios`) },
  ]
  if (i.pets) itens.push({ href: `${base}/pets`, label: 'Pets', shortLabel: 'Pets', icon: PawPrint, active: isNavActive(pathname, `${base}/pets`) })
  itens.push({ href: `${base}/mais`, label: 'Mais', shortLabel: 'Mais', icon: Ellipsis, active: emMais })
  return itens
}

/** O que o menu "Mais" lista: Prêmios (módulo Fidelidade), Loja (módulo Loja) e Minha conta. Módulo desligado some. */
export function maisItems(slug: string, modules: Pick<Modules, 'loyalty' | 'store'>): { href: string; label: string; icon: LucideIcon }[] {
  return [
    ...(modules.loyalty ? [{ href: `/${slug}/premios`, label: 'Prêmios', icon: Gift }] : []),
    ...(modules.store ? [{ href: `/${slug}/loja`, label: 'Loja', icon: ShoppingBag }] : []),
    { href: '/conta', label: 'Minha conta', icon: UserRound },
  ]
}
