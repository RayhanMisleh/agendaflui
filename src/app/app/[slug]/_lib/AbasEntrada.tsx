import { NavTabs } from '@/ui/components'

/** Entrar | Criar conta, no topo do cartão de entrada da loja. */
export function AbasEntrada({ slug }: { slug: string }) {
  return (
    <NavTabs
      label="Entrar ou criar conta"
      className="af-entry__tabs"
      items={[
        { id: 'entrar', label: 'Entrar', href: `/${slug}/entrar`, exact: true },
        { id: 'cadastro', label: 'Criar conta', href: `/${slug}/cadastro`, exact: true },
      ]}
    />
  )
}
