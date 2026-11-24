import Link from 'next/link'
import { ChevronRight, Gift } from 'lucide-react'
import type { CustomerHome } from '@/server/domain/scheduling/customer-home'
import type { Storefront } from '@/server/domain/storefront/storefront'
import { pointsText } from '@/shared/terms'
import { AgendarDeNovo } from './AgendarDeNovo'
import { Banners } from './Banners'
import { HeroiProximo } from './HeroiProximo'
import { SeusPets } from './SeusPets'

/**
 * O Início do cliente: a saudação, o próximo horário em destaque e, ao lado (no computador) ou embaixo (no celular), repetir o
 * último atendimento, os banners, os pets e os pontos. Não há nada de outro cliente aqui: o domínio só entrega o que é dele.
 */
export function Inicio({ slug, home, storefront, today }: { slug: string; home: CustomerHome; storefront: Pick<Storefront, 'phone' | 'petNiche'>; today: string }) {
  return (
    <div className="af-cl-home af-cl-home--grid">
      <h2 className="af-cl-greeting">Oi, {home.firstName}</h2>
      <div className="af-cl-home__main">
        <HeroiProximo slug={slug} next={home.next} today={today} storefront={storefront} />
        <Banners slug={slug} banners={home.banners} />
      </div>
      <div className="af-cl-home__side">
        {home.rebook ? <AgendarDeNovo slug={slug} rebook={home.rebook} /> : null}
        {storefront.petNiche ? <SeusPets slug={slug} pets={home.pets} /> : null}
        {home.points !== null ? (
          <Link href={`/${slug}/premios`} className="af-cl-points">
            <span className="af-cl-points__what">
              <Gift size={18} aria-hidden="true" />
              {pointsText(home.points)}
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  )
}
