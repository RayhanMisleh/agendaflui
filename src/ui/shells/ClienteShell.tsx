import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Avatar } from '../components/Avatar'
import { BrandMark } from './BrandMark'
import { ClienteMain } from './ClienteMain'
import { ClienteNavBar } from './ClienteNavBar'
import { PageTransition } from './PageTransition'
import { cx } from '../components/cx'

/** O site da Agenda Flui, para o "feito com" do rodapé. */
export const SITE_AGENDA_FLUI = 'https://agendaflui.com.br'

/** "Feito com Agenda Flui", discreto: no rodapé das telas da loja. */
export function FeitoCom({ className }: { className?: string }) {
  return (
    <p className={cx('af-cl-made', className)}>
      <a href={SITE_AGENDA_FLUI} target="_blank" rel="noopener noreferrer">
        Feito com Agenda Flui
      </a>
    </p>
  )
}

/** Logo (ou nome) da loja: leva ao início da loja. */
export function LojaMarca({ store }: { store: { name: string; logoUrl: string | null; symbolUrl: string | null; slug: string } }) {
  return (
    <Link href={`/${store.slug}`} className={cx('af-cl-brand', store.symbolUrl && 'af-cl-brand--symbol')}>
      {store.symbolUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- o símbolo vem do armazenamento da conta
        <img src={store.symbolUrl} alt={store.logoUrl ? store.name : ''} className="af-cl-brand__symbol" />
      ) : null}
      <BrandMark name={store.name} logoUrl={store.logoUrl} size="md" />
    </Link>
  )
}

/**
 * Moldura da área do cliente, dentro do tema da loja: mora no layout e NÃO remonta ao navegar, só o miolo troca. Celular:
 * barra do topo (logo ou nome da loja e o avatar, que leva a "Mais") e navegação flutuante na base. Computador (≥ 960 px):
 * a navegação sobe para a barra do topo e o conteúdo fica em até 72 rem, alinhado à esquerda. Cada tela desenha o seu miolo
 * com `ClientePagina`.
 */
export function ClienteShell(p: {
  store: { name: string; logoUrl: string | null; symbolUrl: string | null; slug: string }
  pets: boolean
  person: { name: string; avatarUrl?: string | null } | null
  children: ReactNode
  testId?: string
}) {
  return (
    <div className="af-cl-shell" data-testid={p.testId ?? 'cliente-shell'}>
      <a className="af-skip" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="af-cl-top">
        <LojaMarca store={p.store} />
        <ClienteNavBar slug={p.store.slug} pets={p.pets} placement="top" />
        {p.person ? (
          <Link href={`/${p.store.slug}/mais`} className="af-cl-avatar" aria-label="Mais opções e Minha conta">
            <Avatar name={p.person.name} src={p.person.avatarUrl ?? null} size="sm" />
          </Link>
        ) : null}
      </header>
      <ClienteMain slug={p.store.slug}>{p.children}</ClienteMain>
      <ClienteNavBar slug={p.store.slug} pets={p.pets} placement="bottom" />
    </div>
  )
}

/**
 * O miolo de uma tela do cliente: voltar, título (o único `h1`; `hideTitle` o deixa só para o leitor de tela quando a própria
 * tela abre com um destaque), ações e o corpo, dentro da transição de página. A moldura (barra e navegação) fica no layout.
 */
export function ClientePagina(p: {
  title: string
  hideTitle?: boolean
  back?: { href: string; label: string }
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <PageTransition>
      <div className="af-cl-inner">
        {p.back ? (
          <Link href={p.back.href} className="af-cl-back">
            <ChevronLeft size={18} aria-hidden="true" />
            {p.back.label}
          </Link>
        ) : null}
        <div className={cx('af-cl-head', p.hideTitle && 'af-cl-head--hidden')}>
          <h1 className={cx('af-cl-title', p.hideTitle && 'af-sr')}>{p.title}</h1>
          {p.actions ? <div className="af-cl-head__actions">{p.actions}</div> : null}
        </div>
        <div className="af-cl-body">{p.children}</div>
        <FeitoCom />
      </div>
    </PageTransition>
  )
}
