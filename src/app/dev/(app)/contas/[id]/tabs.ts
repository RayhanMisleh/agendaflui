import type { NavTabItem } from '@/ui/components/NavTabs'

/** As abas da conta, em ordem. Cada uma é uma rota; "Integrações" guarda os segredos do Mercado Pago e da Frenet. */
export const ACCOUNT_TABS: ReadonlyArray<{ id: string; label: string; path: string }> = [
  { id: 'resumo', label: 'Resumo', path: '' },
  { id: 'marca', label: 'Marca', path: '/marca' },
  { id: 'termos', label: 'Termos', path: '/termos' },
  { id: 'modulos', label: 'Módulos', path: '/modulos' },
  { id: 'regras', label: 'Regras', path: '/regras' },
  { id: 'equipe', label: 'Equipe', path: '/equipe' },
  { id: 'chaves', label: 'Chaves', path: '/chaves' },
  { id: 'integracoes', label: 'Integrações', path: '/integracoes' },
  { id: 'auditoria', label: 'Auditoria', path: '/auditoria' },
]

export function accountTabs(businessId: string): NavTabItem[] {
  return ACCOUNT_TABS.map((t) => ({ id: t.id, label: t.label, href: `/contas/${businessId}${t.path}`, exact: t.path === '' }))
}
