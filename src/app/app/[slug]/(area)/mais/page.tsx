import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, LayoutDashboard, LogOut, Store } from 'lucide-react'
import { requireCustomer } from '@/server/auth/guards'
import { getPersonAccount } from '@/server/auth/person-account'
import { getNotificationPreferences } from '@/server/domain/customers/preferences'
import { Avatar, Card, SubmitButton } from '@/ui/components'
import { maisItems } from '@/ui/shells'
import { sair } from '../../../conta/actions'
import { ClientePagina } from '@/ui/shells'
import { modulosDaLoja } from '../../_lib/modulos'
import { metadataDaLoja } from '../../_lib/loja'
import { AvisosForm } from './AvisosForm'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataDaLoja((await params).slug, 'Mais')
}

/**
 * Mais: quem está entrando, Prêmios e Loja (só com o módulo ligado), Minha conta, os avisos por e-mail, trocar de loja
 * (com duas ou mais), abrir o painel (equipe), sair e excluir a conta nesta loja.
 */
export default async function MaisPage({ params }: Props) {
  const { slug } = await params
  const visit = await requireCustomer(slug, `/${slug}/mais`)
  const [modulos, avisos, conta] = await Promise.all([modulosDaLoja(visit), getNotificationPreferences(visit.ctx), getPersonAccount(visit.person.userId, visit.store.businessId)])
  const itens = maisItems(slug, modulos)
  return (
    <ClientePagina title="Mais">
      <div className="af-cl-me">
        <Avatar name={visit.person.name} size="lg" />
        <div className="af-cl-me__who">
          <p className="af-cl-me__name">{visit.person.name}</p>
          <p className="af-cl-me__email">{visit.person.email}</p>
        </div>
      </div>
      <ul className="af-cl-menu">
        {itens.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link href={item.href} className="af-cl-menu__row">
                <span className="af-cl-menu__icon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="af-cl-menu__label">{item.label}</span>
                <ChevronRight size={18} aria-hidden="true" className="af-cl-menu__chevron" />
              </Link>
            </li>
          )
        })}
        {conta.stores.length >= 2 ? (
          <li>
            <Link href="/conta#conta-lojas" className="af-cl-menu__row">
              <span className="af-cl-menu__icon" aria-hidden="true">
                <Store size={20} />
              </span>
              <span className="af-cl-menu__label">Trocar de loja</span>
              <ChevronRight size={18} aria-hidden="true" className="af-cl-menu__chevron" />
            </Link>
          </li>
        ) : null}
        {visit.isStaff ? (
          <li>
            <Link href="/painel" className="af-cl-menu__row">
              <span className="af-cl-menu__icon" aria-hidden="true">
                <LayoutDashboard size={20} />
              </span>
              <span className="af-cl-menu__label">Abrir painel</span>
              <ChevronRight size={18} aria-hidden="true" className="af-cl-menu__chevron" />
            </Link>
          </li>
        ) : null}
      </ul>
      <Card as="section" aria-labelledby="mais-avisos">
        <h2 id="mais-avisos" className="af-cl-section">
          Avisos por e-mail
        </h2>
        <AvisosForm slug={slug} emailAppointments={avisos.emailAppointments} emailMarketing={avisos.emailMarketing} />
      </Card>
      <div className="af-cl-mais__foot">
        <form action={sair}>
          <SubmitButton variant="ghost" icon={<LogOut size={18} />}>
            Sair
          </SubmitButton>
        </form>
        <Link href={`/${slug}/mais/excluir`} className="af-cl-danger-link">
          Excluir minha conta nesta loja
        </Link>
      </div>
    </ClientePagina>
  )
}
