import type { ReactNode } from 'react'
import { ThemeScope } from '../theme/ThemeScope'
import type { ThemeTokens } from '../theme/derive'
import { ShellFrame } from './ShellFrame'
import type { NavItem } from './nav'

export type { NavItem } from './nav'

/** Moldura do painel do negócio: a agenda de balcão (capa com a marca, divisórias, folha de papel). */
export function PainelShell(p: {
  theme: ThemeTokens
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null }
  nav: NavItem[]
  user: { name: string; roleLabel: string; avatarUrl: string | null }
  /** "Você está no painel de X como suporte": faixa permanente, sem botão de fechar. */
  supportBanner?: string
  /** Botão da faixa de suporte ("Encerrar"). */
  supportAction?: ReactNode
  title: string
  actions?: ReactNode
  children: ReactNode
  testId?: string
  embedded?: boolean
  contentId?: string
  headingLevel?: 1 | 2
}) {
  return (
    <ThemeScope theme={p.theme} testId={p.testId ?? 'painel-shell'}>
      <ShellFrame
        variant="painel"
        brand={p.brand}
        nav={p.nav}
        user={p.user}
        banner={p.supportBanner}
        bannerAction={p.supportAction}
        title={p.title}
        actions={p.actions}
        embedded={p.embedded}
        contentId={p.contentId}
        headingLevel={p.headingLevel}
      >
        {p.children}
      </ShellFrame>
    </ThemeScope>
  )
}
