import type { Metadata } from 'next'
import { Plus } from 'lucide-react'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listBusinesses } from '@/server/domain/platform/businesses'
import type { BusinessStatus } from '@/server/domain/platform/businesses'
import { Card, EmptyState, LinkButton, NavTabs, Pagination, SearchBar } from '@/ui/components'
import { DevFrame } from '../DevFrame'
import { um } from '@/app/_lib/params'
import { ContasTable } from './ContasTable'

export const metadata: Metadata = { title: 'Contas | Agenda Flui' }

const SITUACOES: BusinessStatus[] = ['ACTIVE', 'SUSPENDED', 'ARCHIVED']
const FILTRO_SITUACAO = [
  { value: '', label: 'Todas' },
  { value: 'ACTIVE', label: 'Ativas' },
  { value: 'SUSPENDED', label: 'Suspensas' },
  { value: 'ARCHIVED', label: 'Arquivadas' },
]

/** O endereço da lista com a busca e a situação escolhidas (sem cursor: trocar o filtro recomeça a lista). */
function enderecoDaLista(search: string, status: string): string {
  const p = new URLSearchParams()
  if (search) p.set('search', search)
  if (status) p.set('status', status)
  const q = p.toString()
  return q ? `/contas?${q}` : '/contas'
}

export default async function ContasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin()
  const q = await searchParams
  const search = um(q.search).trim().slice(0, 100)
  const status = SITUACOES.find((s) => s === um(q.status))
  const cursor = um(q.cursor) || null

  let pagina: Awaited<ReturnType<typeof listBusinesses>> | null = null
  let aviso: string | null = null
  try {
    pagina = await listBusinesses(admin, { ...(search ? { search } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: 50 })
  } catch (err) {
    if (!(err instanceof DomainError) || err.code !== 'validation') throw err
    aviso = err.message
  }

  const filtrado = search !== '' || status !== undefined
  const params = { search: search || undefined, status }
  const contas = (pagina?.items ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    status: c.status,
    ownerName: c.ownerName,
  }))

  const vazio = aviso ? (
    <EmptyState
      title="Esta página da lista não existe mais"
      description={aviso}
      action={<LinkButton href="/contas">Voltar ao início da lista</LinkButton>}
    />
  ) : filtrado ? (
    <EmptyState
      title="Nenhuma conta encontrada"
      description="Nada combina com a busca. Confira a grafia, tente só parte do nome ou do e-mail do dono, ou mude a situação."
      action={<LinkButton href="/contas">Limpar busca</LinkButton>}
    />
  ) : (
    <EmptyState
      title="Nenhuma conta ainda"
      description="Crie a primeira conta: você escolhe a marca, os termos e o dono, e o convite sai por e-mail."
      action={
        <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
          Criar a primeira conta
        </LinkButton>
      }
    />
  )

  return (
    <DevFrame
      admin={admin}
      title="Contas"
      actions={
        <LinkButton href="/contas/nova" variant="primary" icon={<Plus size={18} />}>
          Criar conta
        </LinkButton>
      }
    >
      <Card className="af-listpanel">
        <SearchBar
          action="/contas"
          label="Buscar contas"
          placeholder="Buscar por nome, identificador ou e-mail"
          query={search}
          filters={[]}
          {...(status ? { hidden: { status } } : {})}
          clearHref="/contas"
        />
        <NavTabs
          label="Situação das contas"
          items={FILTRO_SITUACAO.map((f) => ({ id: f.value || 'todas', label: f.label, href: enderecoDaLista(search, f.value), active: (status ?? '') === f.value }))}
        />
        <ContasTable contas={contas} vazio={vazio} />
        {contas.length > 0 ? (
          <p className="af-listpanel__summary">
            {contas.length === 1 ? '1 conta nesta página.' : `${contas.length} contas nesta página.`}
            {filtrado ? ' A lista está filtrada.' : ''}
          </p>
        ) : null}
        <Pagination basePath="/contas" params={params} cursor={cursor} nextCursor={pagina?.nextCursor ?? null} />
      </Card>
    </DevFrame>
  )
}
