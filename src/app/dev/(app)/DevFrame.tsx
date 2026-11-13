import type { ReactNode } from 'react'
import { Building2, KeyRound, LayoutDashboard, ScrollText, Server, ShieldCheck } from 'lucide-react'
import type { Actor } from '@/server/auth/actor'
import { Button } from '@/ui/components'
import { DevShell } from '@/ui/shells'
import type { NavItem } from '@/ui/shells'
import { logoutAdmin } from './actions'

const NAV: NavItem[] = [
  { href: '/', label: 'Visão geral', icon: LayoutDashboard, active: true },
  { href: '/contas', label: 'Contas', icon: Building2, disabled: true },
  { href: '/chaves', label: 'Chaves e API', icon: KeyRound, disabled: true },
  { href: '/sistema', label: 'Sistema', icon: Server, disabled: true },
  { href: '/auditoria', label: 'Auditoria', icon: ScrollText, disabled: true },
  { href: '/admins', label: 'Admins', icon: ShieldCheck, disabled: true },
]

/** Moldura do painel dev (mesa de controle) com o menu e o botão de sair. */
export function DevFrame({
  admin,
  title,
  children,
}: {
  admin: Extract<Actor, { kind: 'platform_admin' }>
  title: string
  children: ReactNode
}) {
  return (
    <DevShell
      nav={NAV}
      admin={{ name: admin.name }}
      title={title}
      actions={
        <form action={logoutAdmin}>
          <Button type="submit" variant="secondary">
            Sair
          </Button>
        </form>
      }
    >
      {children}
    </DevShell>
  )
}
