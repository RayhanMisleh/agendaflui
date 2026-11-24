import type { ReactNode } from 'react'
import { AccountShell } from '@/ui/shells'

/** A moldura de Minha conta (topo com a marca e o aviso flutuante) fica aqui e não remonta; a página desenha só o miolo. */
export default function ContaLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>
}
