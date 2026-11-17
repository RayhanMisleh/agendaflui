import type { ReactNode } from 'react'
import { ThemeScope } from '../theme/ThemeScope'
import type { ThemeTokens } from '../theme/derive'
import { ShellFrame } from './ShellFrame'
import type { NavItem } from './nav'

export type { NavItem } from './nav'

/**
 * Moldura do painel do negócio, dentro do tema da conta: barra lateral na cor da conta (Cheia, Suave, Noite ou Clara),
 * conteúdo sobre o fundo e, no celular, barra do topo e barra flutuante na base.
 */
export function PainelShell(p: {
  theme: ThemeTokens
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null }
  nav: NavItem[]
  user: { name: string; roleLabel: string; avatarUrl: string | null }
  /** Sair e Trocar de conta: vão no pé da barra e no menu da conta do celular. */
  accountActions?: ReactNode
  /** "Você está em modo suporte na conta X": faixa permanente, sem botão de fechar. */
  supportBanner?: string
  /** Botão da faixa de suporte ("Encerrar"). */
  supportAction?: ReactNode
  title: string
  actions?: ReactNode
  children: ReactNode
  testId?: string
  embedded?: boolean
  phone?: boolean
  contentId?: string
  headingLevel?: 1 | 2
}) {
  const dark = p.theme.material === 'leather' || p.theme.material === 'wood'
  return (
    <ThemeScope theme={p.theme} testId={p.testId ?? 'painel-shell'}>
      <ShellFrame
        variant="painel"
        bar={dark ? 'dark' : 'light'}
        bubble={p.theme.material === 'leather'}
        brand={p.brand}
        nav={p.nav}
        user={p.user}
        accountActions={p.accountActions}
        banner={p.supportBanner}
        bannerAction={p.supportAction}
        title={p.title}
        actions={p.actions}
        embedded={p.embedded}
        phone={p.phone}
        contentId={p.contentId}
        headingLevel={p.headingLevel}
      >
        {p.children}
      </ShellFrame>
    </ThemeScope>
  )
}
