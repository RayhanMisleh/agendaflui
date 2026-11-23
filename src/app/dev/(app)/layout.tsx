import type { ReactNode } from 'react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { NightScope } from '@/ui/theme/ThemeScope'

// O layout não roda de novo a cada navegação: cada página e action também chama requirePlatformAdmin.
// O tema noite envolve as páginas e os `loading.tsx`: o esqueleto já sai nas cores do painel dev.
export default async function DevAppLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin()
  return <NightScope>{children}</NightScope>
}
