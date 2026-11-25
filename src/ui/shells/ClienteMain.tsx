'use client'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cx } from '../components/cx'
import { clienteImersivo } from './cliente-nav'

/** O `main` da moldura. Em tela de fluxo (decidido pelo endereço) o rodapé fica mais baixo, sem a navegação da base. */
export function ClienteMain({ slug, children }: { slug: string; children: ReactNode }) {
  const pathname = usePathname() ?? `/${slug}`
  return (
    <main id="conteudo" tabIndex={-1} className={cx('af-cl-main', clienteImersivo(slug, pathname) && 'af-cl-main--immersive')}>
      {children}
    </main>
  )
}
