import type { ReactNode } from 'react'
import { cx } from '../components/cx'
import { ThemeScope } from '../theme/ThemeScope'
import type { ThemeTokens } from '../theme/derive'
import { BrandMark } from './BrandMark'

/**
 * Tela de entrada: a capa da agenda do negócio aberta sobre a mesa. O nome fica em baixo-relevo na capa
 * e o formulário é um cartão sobre ela. Com imagem de entrada, ela vai ao lado como uma foto presa.
 */
export function EntryScreen(p: {
  theme: ThemeTokens
  variant?: 'painel' | 'dev'
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null; loginImageUrl?: string | null; platform?: boolean }
  title: string
  message?: string | null
  children: ReactNode
  testId?: string
  /** Coluna mais larga, para a escolha de conta. */
  wide?: boolean
}) {
  const metal = p.variant === 'dev'
  const image = p.brand.loginImageUrl ?? null
  return (
    <ThemeScope theme={p.theme} testId={p.testId ?? 'entry-screen'}>
      <main className={cx('af-entry af-stitched', metal ? 'af-material-metal' : 'af-cover', image && 'af-entry--image')}>
        {image ? (
          <div className="af-entry__photo" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta */}
            <img src={image} alt="" />
          </div>
        ) : null}
        <div className={cx('af-entry__column', p.wide && 'af-entry__column--wide')}>
          <header className="af-entry__brand">
            {p.brand.symbolUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- o símbolo vem do armazenamento da conta
              <img src={p.brand.symbolUrl} alt="" className="af-entry__symbol" />
            ) : null}
            <BrandMark name={p.brand.name} logoUrl={p.brand.logoUrl} size="lg" platform={p.brand.platform} variant="negative" />
          </header>
          <section className="af-card af-entry__card" aria-labelledby="entrada-titulo">
            <h1 id="entrada-titulo" className="af-entry__title af-engraved">
              {p.title}
            </h1>
            {p.message ? <p className="af-entry__message">{p.message}</p> : null}
            {p.children}
          </section>
          <p className="af-entry__foot af-on-cover-text">Agenda feita com AgendaFlui</p>
        </div>
      </main>
    </ThemeScope>
  )
}
