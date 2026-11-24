import type { Metadata } from 'next'
import { UserPlus } from 'lucide-react'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listCustomers } from '@/server/domain/customers/customers'
import { getCustomerLink } from '@/server/domain/settings/customer-link'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { Card, EmptyState, LinkButton, NavTabs, Pagination, SearchBar } from '@/ui/components'
import { um } from '@/app/_lib/params'
import { LinkParaClientes } from '../_lib/LinkParaClientes'
import { PainelFrame } from '../PainelFrame'
import { ClientesTabela } from './ClientesTabela'
import { TERMS } from '@/shared/terms'

export const metadata: Metadata = { title: 'Clientes | Agenda Flui' }

type Situacao = 'ativos' | 'arquivados' | 'clube'

/** O endereço da lista com a busca e a situação escolhidas (sem cursor: trocar o filtro recomeça a lista). */
function enderecoDaLista(search: string, situacao: Situacao): string {
  const p = new URLSearchParams()
  if (search) p.set('search', search)
  if (situacao !== 'ativos') p.set('situacao', situacao)
  const q = p.toString()
  return q ? `/painel/clientes?${q}` : '/painel/clientes'
}

export default async function ClientesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('view_clients')
  const q = await searchParams
  const [painel, link] = await Promise.all([getPainelContext(ctx), getCustomerLink(ctx)])
  const terms = TERMS
  const plural = terms.customerPlural
  const clube = painel.modules.loyalty
  const pedida = um(q.situacao)
  const situacao: Situacao = pedida === 'arquivados' ? 'arquivados' : pedida === 'clube' && clube ? 'clube' : 'ativos'
  const search = um(q.search).trim().slice(0, 80)
  const cursor = um(q.cursor) || null

  let pagina: Awaited<ReturnType<typeof listCustomers>> | null = null
  let aviso: string | null = null
  try {
    pagina = await listCustomers(ctx, {
      ...(search.length >= 2 ? { search } : {}),
      ...(situacao === 'arquivados' ? { onlyArchived: true } : {}),
      ...(situacao === 'clube' ? { clubOnly: true } : {}),
      ...(cursor ? { cursor } : {}),
      limit: 30,
    })
  } catch (err) {
    if (!(err instanceof DomainError) || err.code !== 'validation') throw err
    aviso = err.message
  }

  const podeEscrever = can(ctx.actor, 'manage_clients')
  const novo = `Adicionar ${terms.customerSingular.toLowerCase()}`
  const filtrado = search.length >= 2 || situacao !== 'ativos'
  const clientes = (pagina?.items ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    phoneLabel: c.phoneLabel,
    email: c.email,
    archived: c.archived,
    hasAccount: c.hasAccount,
    isClubMember: c.isClubMember,
  }))

  const vazio = aviso ? (
    <EmptyState title="Esta página da lista não existe mais" description={aviso} action={<LinkButton href="/painel/clientes">Voltar ao início da lista</LinkButton>} />
  ) : filtrado ? (
    <EmptyState
      title={`Nenhum ${terms.customerSingular.toLowerCase()} encontrado`}
      description="Nada combina com a busca. Confira a grafia ou tente só parte do nome, do telefone ou do e-mail."
      action={<LinkButton href="/painel/clientes">Limpar busca</LinkButton>}
    />
  ) : (
    <EmptyState
      title={`Cadastre ${podeEscrever ? 'o primeiro' : 'os primeiros'} ${plural.toLowerCase()}`}
      description={podeEscrever ? 'Quem você cadastra aqui já pode ser agendado. Quem se cadastrar pelo app aparece nesta lista.' : 'Quem se cadastrar pelo app ou for cadastrado pela equipe aparece nesta lista.'}
      action={
        podeEscrever ? (
          <LinkButton href="/painel/clientes/novo" variant="primary" icon={<UserPlus size={18} />}>
            {novo}
          </LinkButton>
        ) : undefined
      }
    />
  )

  const filtros: { id: Situacao; label: string }[] = [
    { id: 'ativos', label: 'Ativos' },
    { id: 'arquivados', label: 'Arquivados' },
    ...(clube ? [{ id: 'clube' as const, label: `Do ${TERMS.club}` }] : []),
  ]
  const params = { search: search || undefined, situacao: situacao === 'ativos' ? undefined : situacao }

  return (
    <PainelFrame
      ctx={ctx}
      title={plural}
      actions={
        podeEscrever ? (
          <LinkButton href="/painel/clientes/novo" variant="primary" icon={<UserPlus size={18} />}>
            {novo}
          </LinkButton>
        ) : null
      }
    >
      <div className="af-stack">
        {link ? <LinkParaClientes link={link} /> : null}
        <Card className="af-listpanel" as="section" aria-label={plural}>
          <SearchBar
            action="/painel/clientes"
            label={`Buscar ${plural.toLowerCase()}`}
            placeholder="Buscar por nome, telefone ou e-mail"
            query={search}
            filters={[]}
            {...(situacao !== 'ativos' ? { hidden: { situacao } } : {})}
            clearHref="/painel/clientes"
          />
          <NavTabs label="Situação" items={filtros.map((f) => ({ id: f.id, label: f.label, href: enderecoDaLista(search, f.id), active: situacao === f.id }))} />
          <ClientesTabela clientes={clientes} vazio={vazio} clube={clube ? TERMS.club : null} />
          {clientes.length > 0 ? (
            <p className="af-listpanel__summary">
              {clientes.length === 1 ? '1 cadastro nesta página.' : `${clientes.length} cadastros nesta página.`}
              {filtrado ? ' A lista está filtrada.' : ''}
            </p>
          ) : null}
          <Pagination basePath="/painel/clientes" params={params} cursor={cursor} nextCursor={pagina?.nextCursor ?? null} />
        </Card>
      </div>
    </PainelFrame>
  )
}
