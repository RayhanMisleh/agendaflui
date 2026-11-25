'use client'
import { useState } from 'react'
import type { CSSProperties } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { safeReturnPath } from '@/shared/return-path'
import { cx } from '@/ui/components/cx'

/**
 * Entrar | Criar conta, no topo do cartão de entrada da loja. Mora no layout, então não remonta ao trocar de aba: o
 * indicador desliza (só `transform`) e a aba escolhida já vale no toque, sem esperar a página nova chegar.
 */
export function AbasEntrada({ slug }: { slug: string }) {
  const pathname = usePathname()
  const volta = safeReturnPath(slug, useSearchParams().get('volta'))
  // A aba tocada vale enquanto a rota de onde se tocou continua a mesma; quando a rota muda, volta a valer o endereço.
  const [toque, setToque] = useState<{ href: string; de: string } | null>(null)
  const consulta = volta ? `?volta=${encodeURIComponent(volta)}` : ''
  const abas = [
    { id: 'entrar', label: 'Entrar', href: `/${slug}/entrar` },
    { id: 'cadastro', label: 'Criar conta', href: `/${slug}/cadastro` },
  ]
  const atual = toque && toque.de === pathname ? toque.href : pathname
  const indice = Math.max(0, abas.findIndex((a) => a.href === atual))
  return (
    <nav aria-label="Entrar ou criar conta" className="af-entry__seg" style={{ '--seg': indice } as CSSProperties}>
      <span className="af-entry__seg-thumb" aria-hidden="true" />
      {abas.map((aba, i) => (
        <Link
          key={aba.id}
          href={`${aba.href}${consulta}`}
          className={cx('af-entry__seg-tab', i === indice && 'af-entry__seg-tab--active')}
          aria-current={aba.href === pathname ? 'page' : undefined}
          onClick={() => setToque({ href: aba.href, de: pathname })}
        >
          {aba.label}
        </Link>
      ))}
    </nav>
  )
}
