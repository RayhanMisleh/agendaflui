'use client'

import { ErroEntrada } from '@/app/_lib/ErroEntrada'
import { fontVariables } from '@/ui/theme/fonts'
import './globals.css'

/** Última rede: falha no próprio layout raiz. Precisa de `html` e `body` porque substitui o layout inteiro. */
export default function ErroGlobal(p: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR" className={fontVariables}>
      <body>
        <ErroEntrada {...p} />
      </body>
    </html>
  )
}
