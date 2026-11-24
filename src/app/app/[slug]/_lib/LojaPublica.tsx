import { MapPin, MessageCircle, Phone } from 'lucide-react'
import type { StorePerson } from '@/server/auth/customer-access'
import type { Storefront } from '@/server/domain/storefront/storefront'
import { Avatar, Bubbles, LinkButton } from '@/ui/components'
import { formatMoney } from '@/ui/format'
import { ServiceIcon } from '@/ui/service-icon'
import { FeitoCom } from '@/ui/shells'
import { LOJA_DESATIVADA } from './mensagens'
import { UsarMinhaConta } from './UsarMinhaConta'

export type LojaPublicaVisit =
  | { kind: 'anonymous' }
  | { kind: 'visitor'; person: StorePerson; isStaff: boolean; blocked: boolean }

/**
 * A página pública da loja (`/<slug>` sem ser cliente): capa, nome, contato, serviços com o preço "a partir de" e o prazo para
 * mudar um horário. As ações ficam fixas no pé do celular: visitante anônimo vê Agendar e Entrar; quem entrou mas ainda não é
 * cliente vê o cartão "Usar minha conta nesta loja" (abrir a página nunca cria ninguém); conta desativada vê o aviso.
 */
export function LojaPublica(p: {
  slug: string
  brand: { name: string; logoUrl: string | null; symbolUrl: string | null; loginImageUrl: string | null }
  storefront: Storefront
  visit: LojaPublicaVisit
  /** Caminho de volta já validado (`safeReturnPath`), para depois de entrar ou usar a conta. */
  volta: string | null
}) {
  const { brand, storefront: s, visit } = p
  const agendar = `/${p.slug}/agendar`
  const voltaOuAgendar = p.volta ?? agendar
  const logo = brand.logoUrl ?? brand.symbolUrl
  const blocked = visit.kind === 'visitor' && visit.blocked
  return (
    <main id="conteudo" tabIndex={-1} className="af-cl-public" aria-labelledby="loja-nome">
      <section className="af-cl-cover">
        {brand.loginImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a imagem vem do armazenamento da conta
          <img src={brand.loginImageUrl} alt="" className="af-cl-cover__image" />
        ) : (
          <Bubbles on="brand" count={4} />
        )}
      </section>
      <div className="af-cl-public__body">
        <div className="af-cl-public__logo">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- a logo vem do armazenamento da conta
            <img src={logo} alt="" />
          ) : (
            <Avatar name={brand.name} size="lg" />
          )}
        </div>
        <h1 id="loja-nome" className="af-cl-public__name">
          {brand.name}
        </h1>
        <ul className="af-cl-contact">
          {s.address ? (
            <li>
              <MapPin size={18} aria-hidden="true" />
              <span>{s.address}</span>
            </li>
          ) : null}
          {s.phone ? (
            <li>
              <Phone size={18} aria-hidden="true" />
              <a href={s.phone.href}>{s.phone.label}</a>
              {s.phone.whatsappHref ? (
                <a href={s.phone.whatsappHref} target="_blank" rel="noopener noreferrer" className="af-cl-contact__wa">
                  <MessageCircle size={16} aria-hidden="true" />
                  WhatsApp
                </a>
              ) : null}
            </li>
          ) : null}
        </ul>

        {visit.kind === 'visitor' && !blocked ? (
          <UsarMinhaConta slug={p.slug} volta={voltaOuAgendar} person={visit.person} label="Usar minha conta e agendar" />
        ) : null}
        {blocked ? (
          <p role="alert" className="af-cl-notice">
            {LOJA_DESATIVADA}
          </p>
        ) : null}

        <section className="af-cl-services" aria-labelledby="servicos-titulo">
          <h2 id="servicos-titulo" className="af-cl-section">
            Serviços
          </h2>
          {s.services.length === 0 ? (
            <p className="af-cl-muted">A loja ainda não publicou os serviços. Fale com ela para agendar.</p>
          ) : (
            <ul className="af-cl-services__list">
              {s.services.map((v) => (
                <li key={v.id} className="af-cl-service">
                  <span className="af-cl-service__icon">
                    <ServiceIcon name={v.icon} size={20} />
                  </span>
                  <span className="af-cl-service__main">
                    <span className="af-cl-service__name">
                      {v.name}
                      {v.clubOnly ? <span className="af-cl-pill">Clube</span> : null}
                    </span>
                    {v.description ? <span className="af-cl-service__desc">{v.description}</span> : null}
                    <span className="af-cl-service__meta">{v.durationLabel}</span>
                  </span>
                  <span className="af-cl-service__price">
                    {v.from ? `${v.from.varies ? 'a partir de ' : ''}${formatMoney(v.from.cents)}` : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="af-cl-muted af-cl-public__rule">Prazo para mudar um horário: {s.rules.changeWindowLabel}.</p>
        <FeitoCom />
      </div>
      <div className="af-cl-public__actions">
        {visit.kind === 'anonymous' ? (
          <>
            <LinkButton href={`/${p.slug}/entrar?volta=${encodeURIComponent(agendar)}`} variant="primary" size="lg">
              Agendar
            </LinkButton>
            <LinkButton href={`/${p.slug}/entrar${p.volta ? `?volta=${encodeURIComponent(p.volta)}` : ''}`} variant="secondary" size="lg">
              Entrar
            </LinkButton>
          </>
        ) : (
          <>
            {visit.isStaff ? (
              <LinkButton href="/painel" variant="secondary" size="lg">
                Abrir painel
              </LinkButton>
            ) : null}
            <LinkButton href="/conta" variant="ghost" size="lg">
              Minha conta
            </LinkButton>
          </>
        )}
      </div>
    </main>
  )
}
