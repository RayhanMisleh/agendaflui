import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ToastProvider } from '../components/Toast'
import { ThemeScope } from '../theme/ThemeScope'
import { AGENDAFLUI_BRAND } from '../theme/default-brand'
import { deriveTheme } from '../theme/derive'
import { BrandMark } from './BrandMark'
import { PageTransition } from './PageTransition'

const THEME = deriveTheme(AGENDAFLUI_BRAND)

/**
 * Moldura de "Minha conta": barra do topo com a marca Agenda Flui e, abaixo, a página. Mora no `layout.tsx`, então não
 * remonta ao navegar. É da pessoa, não de uma loja: a marca é sempre a da plataforma. Já traz o aviso flutuante
 * (`useToast`) para as seções.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <ThemeScope theme={THEME} testId="account-shell">
      <ToastProvider>
        <div className="af-account">
          <header className="af-account__top">
            <BrandMark name="Agenda Flui" logoUrl={null} size="md" platform />
          </header>
          {children}
        </div>
      </ToastProvider>
    </ThemeScope>
  )
}

/** A página de "Minha conta": coluna central (até 40 rem) com o título, o link de volta e as seções. Leva a transição. */
export function AccountPage({ title, back, children }: { title: string; back: { href: string; label: string } | null; children: ReactNode }) {
  return (
    <PageTransition>
      <main className="af-account__main">
        {back ? (
          <Link href={back.href} className="af-account__back">
            <ArrowLeft size={18} aria-hidden="true" />
            <span>{back.label}</span>
          </Link>
        ) : null}
        <h1 className="af-account__title">{title}</h1>
        {children}
      </main>
    </PageTransition>
  )
}
