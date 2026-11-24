import { NavTabs } from '@/ui/components'

/** As abas de Sistema: cada uma é uma rota. */
export function SistemaTabs() {
  return (
    <NavTabs
      label="Abas do sistema"
      items={[
        { id: 'geral', label: 'Visão geral', href: '/sistema', exact: true },
        { id: 'google', label: 'Google', href: '/sistema/google', exact: true },
      ]}
    />
  )
}
