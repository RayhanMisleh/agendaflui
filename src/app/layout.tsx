import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { fontVariables } from '@/ui/theme/fonts'
import './globals.css'

// Ícones da marca Agenda Flui (public/): valem nos três hosts; o painel do negócio troca pelo favicon da conta, se houver.
export const metadata: Metadata = {
  title: 'Agenda Flui',
  applicationName: 'Agenda Flui',
  icons: {
    icon: [
      { url: '/brand/agendaflui-simbolo.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '16x16 32x32 48x48' },
    ],
    apple: { url: '/brand/agendaflui-icone-180.png', sizes: '180x180' },
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={fontVariables}>
      <body>{children}</body>
    </html>
  )
}
