import type { ReactNode } from 'react'
import type { Actor } from '@/server/auth/actor'
import { Button, LinkButton } from '@/ui/components'
import { DevShell } from '@/ui/shells'
import { DEV_NAV } from '@/ui/shells/dev-nav'
import { logoutAdmin } from './actions'

/** Moldura do painel dev (mesa de controle) com o menu, ações da tela e o botão de sair. */
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
      actions={
        <>
          {actions}
          <LinkButton href="/perfil" variant="ghost">
            Meu perfil
          </LinkButton>
          <form action={logoutAdmin}>
            <Button type="submit" variant="secondary">
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
