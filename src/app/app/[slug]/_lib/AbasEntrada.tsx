import { NavTabs } from '@/ui/components'

/** Entrar | Criar conta, no topo do cartão de entrada da loja. */
export function AbasEntrada({ slug, volta = null }: { slug: string; volta?: string | null }) {
  const consulta = volta ? `?volta=${encodeURIComponent(volta)}` : ''
  return (
    <NavTabs
      label="Entrar ou criar conta"
      className="af-entry__tabs"
      items={[
        { id: 'entrar', label: 'Entrar', href: `/${slug}/entrar${consulta}`, exact: true },
        { id: 'cadastro', label: 'Criar conta', href: `/${slug}/cadastro${consulta}`, exact: true },
      ]}
    />
  )
}
