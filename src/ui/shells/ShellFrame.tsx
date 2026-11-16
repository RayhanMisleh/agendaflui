import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { cx } from '../components/cx'
import { BrandMark } from './BrandMark'
import type { NavItem } from './nav'
import { ShellNav } from './ShellNav'

export type ShellUser = { name: string; roleLabel: string; avatarUrl: string | null }

export type ShellFrameProps = {
  variant: 'painel' | 'dev'
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null }
  nav: NavItem[]
  user: ShellUser
  banner?: string
  /** Botão da faixa de suporte (por exemplo "Encerrar"). Só aparece com `banner`. */
  bannerAction?: ReactNode
  title: string
  actions?: ReactNode
  children: ReactNode
  /** Dentro de outra página (vitrine): sem altura de tela cheia e com cantos de livro. */
  embedded?: boolean
  contentId?: string
  headingLevel?: 1 | 2
}

function UserPlate({ user }: { user: ShellUser }) {
  return (
    <div className="af-userplate">
      <Avatar name={user.name} src={user.avatarUrl} size="md" />
      <span className="af-userplate__text">
        <span className="af-userplate__name">{user.name}</span>
        <span className="af-userplate__role af-on-cover-text">{user.roleLabel}</span>
      </span>
    </div>
  )
}

/** Estrutura comum das duas molduras: capa, divisórias e a folha de conteúdo. */
export function ShellFrame(p: ShellFrameProps) {
  const contentId = p.contentId ?? 'conteudo'
  const titleId = `${contentId}-titulo`
  const Heading = p.headingLevel === 2 ? 'h2' : 'h1'
  const Main = p.embedded ? 'section' : 'main'
  const navNodes = p.nav.map((n) => {
    const Icon = n.icon
    return { href: n.href, label: n.label, active: n.active, disabled: n.disabled, icon: <Icon size={20} /> }
  })
  const coverClass = p.variant === 'dev' ? 'af-material-metal' : 'af-cover'

  return (
    <div className={cx('af-shell', `af-shell--${p.variant}`, p.embedded && 'af-shell--embedded')}>
      <a className="af-skip" href={`#${contentId}`}>
        Pular para o conteúdo
      </a>
      {p.banner ? (
        <div className="af-shell__support" role="note">
          <Info size={18} aria-hidden="true" />
          <span>{p.banner}</span>
          {p.bannerAction ? <span className="af-shell__support-action">{p.bannerAction}</span> : null}
        </div>
      ) : null}
      <div className="af-shell__frame">
        {/* Chapa do material: só no computador, ocupa a altura toda atrás da coluna. */}
        <div className={cx('af-shell__plate af-stitched', coverClass)} aria-hidden="true" />
        {/* Coluna: marca no topo, menu no meio (cresce e rola sozinho), usuário na base. Fica colada à tela. */}
        <div className="af-shell__rail">
          <header className={cx('af-shell__top af-stitched', coverClass)}>
            <div className="af-shell__brand">
              {p.brand.symbolUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- o símbolo vem do armazenamento da conta
                <img src={p.brand.symbolUrl} alt="" className="af-shell__symbol" />
              ) : null}
              <BrandMark name={p.brand.name} logoUrl={p.brand.logoUrl} size="lg" />
            </div>
            <p className="af-shell__bartitle af-engraved" aria-hidden="true">
              {p.title}
            </p>
          </header>
          <ShellNav items={navNodes} userPlate={<UserPlate user={p.user} />} />
          <div className="af-shell__user">
            <UserPlate user={p.user} />
          </div>
        </div>
        <Main
          id={contentId}
          tabIndex={-1}
          aria-labelledby={p.embedded ? titleId : undefined}
          className={cx('af-shell__sheet', p.variant === 'dev' && 'af-material-metal')}
        >
          <div className="af-shell__head">
            <Heading id={titleId} className="af-shell__title af-engraved">
              {p.title}
            </Heading>
            {p.actions ? <div className="af-shell__actions">{p.actions}</div> : null}
          </div>
          <div className="af-shell__body">{p.children}</div>
        </Main>
      </div>
    </div>
  )
}
