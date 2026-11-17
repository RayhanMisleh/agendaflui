import type { ReactNode } from 'react'
import { Bubbles } from '../components/Bubbles'
import { cx } from '../components/cx'
import { NightScope, ThemeScope } from '../theme/ThemeScope'
import { AGENDAFLUI_BRAND } from '../theme/default-brand'
import { deriveTheme } from '../theme/derive'
import type { ThemeTokens } from '../theme/derive'
import { BrandMark } from './BrandMark'

/**
 * Tela de entrada, em duas partes: à esquerda o bloco de destaque (cor da conta, bolhas, logo e uma frase grande);
 * à direita o formulário num cartão que flutua. No celular o bloco vira uma faixa no topo e o cartão sobe sobre ela.
 * No painel dev (`variant="dev"`) a tela inteira usa o tema noite da marca.
 */
export function EntryScreen(p: {
  /** Tema da conta; sem ele vale o da marca Agenda Flui. No dev vale sempre o tema noite. */
  theme?: ThemeTokens
  variant?: 'painel' | 'dev'
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null; loginImageUrl?: string | null; platform?: boolean }
  /** A frase grande do bloco de destaque: "A agenda que flui.", o nome da conta ou "Painel da plataforma". */
  headline: string
  /** Frase de apoio sob a frase grande (a mensagem de entrada da conta). */
  lede?: string | null
  title: string
  message?: string | null
  children: ReactNode
  testId?: string
  /** Cartão mais largo, para a escolha de conta. */
  wide?: boolean
  /** Dentro de outra página (vitrine): altura própria e borda de cartão. */
  embedded?: boolean
  /** Com `embedded`, mostra a tela do celular (bloco como faixa no topo) em vez da do computador. */
  phone?: boolean
}) {
  const image = p.brand.loginImageUrl ?? null
  const body = (
    <main className={cx('af-entry', p.variant === 'dev' && 'af-entry--dev', image && 'af-entry--image', p.embedded && 'af-entry--embedded', p.phone && 'af-entry--phone')}>
      <section className="af-entry__hero">
        <Bubbles on="brand" count={4} />
        <header className="af-entry__brand">
          {p.brand.symbolUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- o símbolo vem do armazenamento da conta
            <img src={p.brand.symbolUrl} alt="" className="af-entry__symbol" />
          ) : null}
          <BrandMark name={p.brand.name} logoUrl={p.brand.logoUrl} size="lg" platform={p.brand.platform} variant="on-color" />
        </header>
        <div className="af-entry__pitch">
          <p className="af-entry__headline">{p.headline}</p>
          {p.lede ? <p className="af-entry__lede">{p.lede}</p> : null}
        </div>
        {image ? (
          <div className="af-entry__photo" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta */}
            <img src={image} alt="" />
          </div>
        ) : null}
      </section>
      <div className="af-entry__panel">
        <section className={cx('af-card af-entry__card', p.wide && 'af-entry__card--wide')} aria-labelledby="entrada-titulo">
          <h1 id="entrada-titulo" className="af-entry__title">
            {p.title}
          </h1>
          {p.message ? <p className="af-entry__message">{p.message}</p> : null}
          {p.children}
        </section>
        <p className="af-entry__foot">Agenda feita com Agenda Flui</p>
      </div>
    </main>
  )
  if (p.variant === 'dev') return <NightScope testId={p.testId ?? 'entry-screen'}>{body}</NightScope>
  return (
    <ThemeScope theme={p.theme ?? deriveTheme(AGENDAFLUI_BRAND)} testId={p.testId ?? 'entry-screen'}>
      {body}
    </ThemeScope>
  )
}
