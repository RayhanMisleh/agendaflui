import type { ReactNode } from 'react'
import { NightScope } from '../theme/ThemeScope'
import { ShellFrame } from './ShellFrame'
import type { NavItem } from './nav'

/** Moldura do painel dev: a mesma estrutura no tema noite da marca, sempre com a marca Agenda Flui em negativo. */
export function DevShell(p: {
  nav: NavItem[]
  admin: { name: string }
  title: string
  /** Meu perfil e Sair: vão no pé da barra e no menu da conta do celular. */
  accountActions?: ReactNode
  actions?: ReactNode
  children: ReactNode
  testId?: string
  embedded?: boolean
  phone?: boolean
  contentId?: string
  headingLevel?: 1 | 2
}) {
  return (
    <NightScope testId={p.testId ?? 'dev-shell'}>
      <ShellFrame
        variant="dev"
        bar="dark"
        brand={{ name: 'Agenda Flui', logoUrl: null, symbolUrl: null, platform: true }}
        nav={p.nav}
        user={{ name: p.admin.name, roleLabel: 'Administração', avatarUrl: null }}
        accountActions={p.accountActions}
        title={p.title}
        actions={p.actions}
        embedded={p.embedded}
        phone={p.phone}
        contentId={p.contentId}
        headingLevel={p.headingLevel}
      >
        {p.children}
      </ShellFrame>
    </NightScope>
  )
}
