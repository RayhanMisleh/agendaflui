'use client'
import { useSyncExternalStore } from 'react'

const semAssinatura = () => () => {}

/** `false` no servidor e na primeira pintura; `true` depois que o JavaScript assumiu. Serve para "melhorar" um formulário que já funciona sem JavaScript. */
export function useHydrated(): boolean {
  return useSyncExternalStore(semAssinatura, () => true, () => false)
}
