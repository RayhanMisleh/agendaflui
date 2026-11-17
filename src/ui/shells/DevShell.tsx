import type { ReactNode } from 'react'
import { ThemeScope } from '../theme/ThemeScope'
import { AGENDAFLUI_BRAND } from '../theme/default-brand'
import { deriveTheme } from '../theme/derive'
import { ShellFrame } from './ShellFrame'
import type { NavItem } from './nav'

const THEME = deriveTheme(AGENDAFLUI_BRAND)

/** Moldura do painel dev: a mesa de controle, em metal. Sempre com a marca AgendaFlui. */
export function DevShell(p: {
  nav: NavItem[]
  admin: { name: string }
  title: string
  actions?: ReactNode
  children: ReactNode
  testId?: string
  embedded?: boolean
  contentId?: string
  headingLevel?: 1 | 2
}) {
  return (
    <ThemeScope theme={THEME} testId={p.testId ?? 'dev-shell'}>
      <ShellFrame
        variant="dev"
        brand={{ name: 'AgendaFlui', logoUrl: null, symbolUrl: null, platform: true }}
        nav={p.nav}
        user={{ name: p.admin.name, roleLabel: 'Administração', avatarUrl: null }}
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
