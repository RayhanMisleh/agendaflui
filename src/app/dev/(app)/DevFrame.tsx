import type { ReactNode } from 'react'
import { LogOut, UserRound } from 'lucide-react'
import type { Actor } from '@/server/auth/actor'
import { Button, LinkButton } from '@/ui/components'
import { DevShell } from '@/ui/shells'
import { DEV_NAV } from '@/ui/shells/dev-nav'
import { logoutAdmin } from './actions'

/** Moldura do painel dev (tema noite) com o menu, ações da tela e o botão de sair. */
export function DevFrame({
  admin,
  title,
  actions,
  children,
}: {
  admin: Extract<Actor, { kind: 'platform_admin' }>
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <DevShell
      nav={DEV_NAV}
      admin={{ name: admin.name }}
      title={title}
      actions={actions}
      accountActions={
        <>
          <LinkButton href="/perfil" variant="secondary" icon={<UserRound size={18} />}>
            Meu perfil
          </LinkButton>
          <form action={logoutAdmin}>
            <Button type="submit" variant="secondary" icon={<LogOut size={18} />}>
              Sair
            </Button>
          </form>
        </>
      }
    >
      {children}
    </DevShell>
  )
}
