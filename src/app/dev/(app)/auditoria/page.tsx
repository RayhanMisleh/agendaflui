import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listAudit } from '@/server/domain/platform/audit-log'
import { listBusinesses } from '@/server/domain/platform/businesses'
import { Button, EmptyState, Field, Input, LinkButton, Pagination, Paper, Select } from '@/ui/components'
import { DevFrame } from '../DevFrame'
import { HorariosNota } from '../_lib/HorariosNota'
import { quando } from '../_lib/format'
import { GlobalAuditTable } from './GlobalAuditTable'
import { TIPOS_DE_ATOR, lerFiltros } from './filtros'

export const metadata: Metadata = { title: 'Auditoria | AgendaFlui' }

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin()
  const filtros = lerFiltros(await searchParams)
  const { query, values } = filtros
  let aviso: string | null = filtros.erro
  let pagina: Awaited<ReturnType<typeof listAudit>> | null = null
  try {
    pagina = await listAudit(admin, { ...query, limit: 50 })
  } catch (err) {
    // Período ou página fora do que o domínio aceita vira mensagem na tela, nunca erro 500.
    if (!(err instanceof DomainError) || err.code !== 'validation') throw err
    aviso = err.message
  }
  const contas = (await listBusinesses(admin, { limit: 100 })).items
  const contaFora = values.conta !== '' && !contas.some((c) => c.id === values.conta)

  const linhas = (pagina?.items ?? []).map((a) => ({
    id: a.id,
    at: quando(a.at),
    actor: a.actorLabel,
    action: a.action,
    conta: a.businessName,
    target: a.targetLabel,
    detail: a.metadata !== null && a.metadata !== undefined && JSON.stringify(a.metadata) !== '{}' ? JSON.stringify(a.metadata, null, 2) : null,
  }))
  const filtrado = Object.keys(query).filter((k) => k !== 'cursor').length > 0
  const params = { conta: values.conta, acao: values.acao, ator: values.ator, de: values.de, ate: values.ate }

  return (
    <DevFrame admin={admin} title="Auditoria">
      <Paper raised={1} className="af-listpanel">
        <form method="get" action="/auditoria" className="af-filters" role="search" aria-label="Filtros da auditoria">
          <Field label="Conta">
            <Select name="conta" defaultValue={values.conta}>
              <option value="">Todas</option>
              {contaFora ? <option value={values.conta}>Conta do filtro</option> : null}
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ação" hint="Nome exato, como api_key.revoked.">
            <Input name="acao" defaultValue={values.acao} maxLength={100} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Quem agiu">
            <Select name="ator" defaultValue={values.ator}>
              <option value="">Todos</option>
              {TIPOS_DE_ATOR.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="De" hint="Padrão: últimos 30 dias.">
            <Input type="date" name="de" defaultValue={values.de} />
          </Field>
          <Field label="Até" hint="O dia inteiro entra. Máximo de 92 dias.">
            <Input type="date" name="ate" defaultValue={values.ate} />
          </Field>
          <div className="af-filters__go">
            <Button type="submit" variant="secondary">
              Filtrar
            </Button>
            {filtrado ? (
              <Link href="/auditoria" className="af-searchbar__clear">
                Limpar filtros
              </Link>
            ) : null}
          </div>
        </form>
        <HorariosNota />
        {aviso ? (
          <p role="alert" className="af-global__msg">
            {aviso}
          </p>
        ) : null}
        <GlobalAuditTable
          linhas={linhas}
          vazio={
            aviso ? (
              <EmptyState title="Não foi possível listar" description="Ajuste os filtros acima ou volte ao início da lista." action={<LinkButton href="/auditoria">Voltar ao início da lista</LinkButton>} />
            ) : (
              <EmptyState
                title={filtrado ? 'Nada registrado com estes filtros' : 'Nada registrado nos últimos 30 dias'}
                description="Toda mudança feita por admins, equipes e pelo sistema aparece aqui."
                {...(filtrado ? { action: <LinkButton href="/auditoria">Limpar filtros</LinkButton> } : {})}
              />
            )
          }
        />
        <Pagination basePath="/auditoria" params={params} cursor={query.cursor ?? null} nextCursor={pagina?.nextCursor ?? null} />
      </Paper>
    </DevFrame>
  )
}
