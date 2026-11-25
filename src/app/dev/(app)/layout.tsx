import type { ReactNode } from 'react'
import { LogOut, UserRound } from 'lucide-react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { Button, LinkButton } from '@/ui/components'
import { DevShell } from '@/ui/shells'
import { DEV_NAV } from '@/ui/shells/dev-nav'
import { logoutAdmin } from './actions'

/**
 * A moldura do painel dev (tema noite, menu, Meu perfil e Sair). Mora aqui, no layout, e por isso não remonta nem pisca ao
 * navegar: cada página desenha só o miolo (`ShellPage`) e cada `loading.tsx` só o esqueleto dele. O layout não roda de novo a
 * cada navegação: cada página e action também chama `requirePlatformAdmin`.
 */
export default async function DevAppLayout({ children }: { children: ReactNode }) {
  const admin = await requirePlatformAdmin()
  return (
    <DevShell
      nav={DEV_NAV}
      admin={{ name: admin.name }}
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
