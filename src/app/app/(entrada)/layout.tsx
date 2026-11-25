import type { ReactNode } from 'react'
import { EntryFrame } from '@/ui/shells'
import { MARCA_ENTRADA, TEMA_ENTRADA } from '../_lib/marca'

/**
 * Moldura das telas de entrada da plataforma (entrar, esqueci a senha, redefinir, convite): o bloco da marca e o cartão ficam
 * aqui, num layout que não remonta ao navegar. Cada página só troca o conteúdo do cartão.
 */
export default function EntradaLayout({ children }: { children: ReactNode }) {
  return (
    <EntryFrame theme={TEMA_ENTRADA} brand={MARCA_ENTRADA} headline="A agenda que flui.">
      {children}
    </EntryFrame>
  )
}
