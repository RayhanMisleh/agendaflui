import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { listAudit } from '@/server/domain/platform/audit-log'
import { findBusinessByRef } from '@/server/domain/platform/businesses'
import { Button, EmptyState, Field, FiltrosRecolhiveis, Input, LinkButton, Pagination, Card, Select } from '@/ui/components'
import { ShellPage } from '@/ui/shells'
import { HorariosNota } from '../_lib/HorariosNota'
import { quando } from '../_lib/format'
import { GlobalAuditTable } from './GlobalAuditTable'
import { TIPOS_DE_ATOR, lerFiltros } from './filtros'

export const metadata: Metadata = { title: 'Auditoria | Agenda Flui' }

export default async function AuditoriaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requirePlatformAdmin()
  const filtros = lerFiltros(await searchParams)
  const { values } = filtros
  const query = { ...filtros.query }
  let aviso: string | null = filtros.erro
  // A conta é digitada (identificador ou id) e resolvida aqui: sem lista de contas, então sem teto de contas.
  let contaNome: string | null = null
  let contaDesconhecida = false
  if (values.conta !== '') {
    const c = await findBusinessByRef(admin, values.conta)
    if (c) {
      query.businessId = c.id
      contaNome = c.name
    } else {
      contaDesconhecida = true
      aviso = 'Nenhuma conta com esse identificador. Confira o identificador na página da conta.'
    }
  }
  let pagina: Awaited<ReturnType<typeof listAudit>> | null = null
  if (!contaDesconhecida) {
    try {
      pagina = await listAudit(admin, { ...query, limit: 50 })
    } catch (err) {
      // Período ou página fora do que o domínio aceita vira mensagem na tela, nunca erro 500.
      if (!(err instanceof DomainError) || err.code !== 'validation') throw err
      aviso = err.message
    }
  }

  const linhas = (pagina?.items ?? []).map((a) => ({
    id: a.id,
    at: quando(a.at),
    actor: a.actorLabel,
    action: a.action,
    conta: a.businessName,
    target: a.targetLabel,
    detail: a.metadata !== null && a.metadata !== undefined && JSON.stringify(a.metadata) !== '{}' ? JSON.stringify(a.metadata, null, 2) : null,
  }))
  const filtrado = Object.keys(query).filter((k) => k !== 'cursor').length > 0 || values.conta !== ''
  const params = { conta: values.conta, acao: values.acao, ator: values.ator, de: values.de, ate: values.ate }

  return (
    <ShellPage title="Auditoria">
      <Card className="af-listpanel">
        <form method="get" action="/auditoria" className="af-report__form af-report__form--stack" role="search" aria-label="Filtros da auditoria">
          <div className="af-report__dates">
            <Field label="De">
              <Input type="date" name="de" defaultValue={values.de} />
            </Field>
            <Field label="Até">
              <Input type="date" name="ate" defaultValue={values.ate} />
            </Field>
          </div>
          <FiltrosRecolhiveis
            ativos={(values.conta !== '' ? 1 : 0) + (values.acao !== '' ? 1 : 0) + (values.ator !== '' ? 1 : 0)}
            filtros={
              <>
                <Field label="Conta" hint={contaNome ? `Conta: ${contaNome}.` : 'Identificador, como estudio-sol. Em branco, todas.'}>
                  <Input name="conta" defaultValue={values.conta} maxLength={100} autoComplete="off" spellCheck={false} />
                </Field>
                <Field label="Ação" hint="Nome exato, como business.status_changed.">
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
              </>
            }
            enviar={
              <Button type="submit" variant="primary">
                Filtrar
              </Button>
            }
          />
        </form>
        <p className="af-section__help">
          Sem datas, valem os últimos 30 dias. O dia de Até entra inteiro; no máximo 92 dias.
          {filtrado ? (
            <>
              {' '}
              <Link href="/auditoria" className="af-searchbar__clear">
                Limpar filtros
              </Link>
            </>
          ) : null}
        </p>
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
      </Card>
    </ShellPage>
  )
}
