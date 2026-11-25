import Link from 'next/link'
import { ChevronRight, Crown } from 'lucide-react'
import { pointsText } from '@/shared/terms'

/** O saldo de pontos do cliente em destaque (bloco no tom Mel), com o selo do Clube e o caminho para o extrato. */
export function Saldo({ slug, balance, clubMember }: { slug: string; balance: number; clubMember: boolean }) {
  return (
    <section className="af-cl-saldo" aria-labelledby="saldo-titulo">
      <h2 id="saldo-titulo" className="af-cl-saldo__label">
        Seu saldo
      </h2>
      <p className="af-cl-saldo__value">{pointsText(balance)}</p>
      <div className="af-cl-saldo__foot">
        {clubMember ? (
          <span className="af-cl-pill af-cl-pill--club">
            <Crown size={14} aria-hidden="true" />
            Você é do Clube
          </span>
        ) : null}
        <Link href={`/${slug}/premios/extrato`} className="af-cl-saldo__link">
          Ver extrato
          <ChevronRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  )
}
