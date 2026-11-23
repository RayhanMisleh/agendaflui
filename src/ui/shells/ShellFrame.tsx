import type { ReactNode } from 'react'
import { cx } from '../components/cx'
import { AccountMenu } from './AccountMenu'
import { BrandMark } from './BrandMark'
import type { NavItem } from './nav'
import { ShellNav } from './ShellNav'
import { UserPlate } from './UserPlate'
import type { ShellUser } from './UserPlate'

export type { ShellUser } from './UserPlate'

export type ShellFrameProps = {
  variant: 'painel' | 'dev'
  /** A barra lateral é escura (Cheia, Noite, painel dev) ou clara (Suave, Clara): decide a versão da marca e da logo. */
  bar: 'dark' | 'light'
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null; platform?: boolean }
  nav: NavItem[]
  user: ShellUser
  /** Sair e Meu perfil: vão no pé da barra (computador) e no menu da conta (celular). */
  accountActions?: ReactNode
  /** Bolha discreta no pé da barra (só a Cheia). */
  bubble?: boolean
  banner?: string
  /** Botão da faixa de suporte (por exemplo "Encerrar"). Só aparece com `banner`. */
  bannerAction?: ReactNode
  title: string
  actions?: ReactNode
  children: ReactNode
  /** Dentro de outra página (vitrine): altura própria e borda de cartão. */
  embedded?: boolean
  /** Com `embedded`, mostra a moldura do celular (barra do topo e barra flutuante na base) em vez da do computador. */
  phone?: boolean
  contentId?: string
  headingLevel?: 1 | 2
}

/**
 * Estrutura comum das duas molduras: faixa de suporte, barra lateral (computador) ou barra do topo e barra flutuante da
 * base (celular), e o conteúdo sobre o fundo `ground`, com cabeçalho de página e ações à direita.
 */
export function ShellFrame(p: ShellFrameProps) {
  const contentId = p.contentId ?? 'conteudo'
  const titleId = `${contentId}-titulo`
  const Heading = p.headingLevel === 2 ? 'h2' : 'h1'
  const Main = p.embedded ? 'section' : 'main'
  const navNodes = p.nav.map((n) => {
    const Icon = n.icon
    return { href: n.href, label: n.label, shortLabel: n.shortLabel, active: n.active, disabled: n.disabled, icon: <Icon size={20} strokeWidth={2} /> }
  })
  // Sobre barra escura, a marca da Agenda Flui e o nome usam a tinta da barra; a do dev é a marca em negativo.
  const markVariant = p.variant === 'dev' ? 'negative' : p.bar === 'dark' ? 'on-color' : 'horizontal'

  return (
    <div
      className={cx(
        'af-shell',
        `af-shell--${p.variant}`,
        `af-shell--bar-${p.bar}`,
        p.embedded && 'af-shell--embedded',
        p.phone && 'af-shell--phone',
        p.banner && 'af-shell--support',
      )}
    >
      <a className="af-skip" href={`#${contentId}`}>
        Pular para o conteúdo
      </a>
      {p.banner ? (
        <div className="af-shell__support" role="note">
          <span className="af-shell__support-dot" aria-hidden="true" />
          <span className="af-shell__support-text">{p.banner}</span>
          {p.bannerAction ? <span className="af-shell__support-action">{p.bannerAction}</span> : null}
        </div>
      ) : null}
      <div className="af-shell__frame">
        <div className="af-shell__side">
          <header className="af-shell__top">
            <div className={cx('af-shell__brand', p.brand.symbolUrl && 'af-shell__brand--symbol')}>
              {p.brand.symbolUrl ? (
                // Na barra estreita do celular o símbolo toma o lugar da logo; por isso ele leva o nome quando há logo.
                // eslint-disable-next-line @next/next/no-img-element -- o símbolo vem do armazenamento da conta
                <img src={p.brand.symbolUrl} alt={p.brand.logoUrl ? p.brand.name : ''} className="af-shell__symbol" />
              ) : null}
              <BrandMark name={p.brand.name} logoUrl={p.brand.logoUrl} size="lg" platform={p.brand.platform} variant={markVariant} />
            </div>
            <AccountMenu user={p.user}>{p.accountActions}</AccountMenu>
          </header>
          <ShellNav items={navNodes} userPlate={<UserPlate user={p.user} />} />
          <footer className="af-shell__foot">
            <UserPlate user={p.user} />
            {p.accountActions ? <div className="af-shell__account">{p.accountActions}</div> : null}
            {p.bubble ? <span className="af-shell__bubble" aria-hidden="true" /> : null}
          </footer>
        </div>
        <Main id={contentId} tabIndex={-1} aria-labelledby={p.embedded ? titleId : undefined} className="af-shell__main">
          <div className="af-shell__inner">
            <div className="af-shell__head">
              <Heading id={titleId} className="af-shell__title">
                {p.title}
              </Heading>
              {p.actions ? <div className="af-shell__actions">{p.actions}</div> : null}
            </div>
            <div className="af-shell__body">{p.children}</div>
          </div>
        </Main>
      </div>
    </div>
  )
}
