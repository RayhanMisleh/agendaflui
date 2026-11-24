'use client'

import { ErroEntrada } from '@/app/_lib/ErroEntrada'

export default function ErroDoApp(p: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErroEntrada {...p} />
}
