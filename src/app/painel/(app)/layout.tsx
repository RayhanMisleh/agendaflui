import type { ReactNode } from 'react'
import { requireTenant } from '@/server/auth/guards'

// O layout não roda de novo a cada navegação: cada página e action também chama requireTenant.
export default async function PainelAppLayout({ children }: { children: ReactNode }) {
  await requireTenant()
  return children
}
