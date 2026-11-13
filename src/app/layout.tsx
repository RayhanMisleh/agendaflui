import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { fontVariables } from '@/ui/theme/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'AgendaFlui',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={fontVariables}>
      <body>{children}</body>
    </html>
  )
}
