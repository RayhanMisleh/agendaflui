import type { ReactNode } from 'react'
import { requirePlatformAdmin } from '@/server/auth/guards'

// O layout não roda de novo a cada navegação: cada página e action também chama requirePlatformAdmin.
export default async function DevAppLayout({ children }: { children: ReactNode }) {
  await requirePlatformAdmin()
  return children
}
