import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requirePlatformAdmin } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getBusinessDetail } from '@/server/domain/platform/businesses'
import { CopyButton, LinkButton, Paper, StatusLamp } from '@/ui/components'
import { DevFrame } from '../../DevFrame'

export const metadata: Metadata = { title: 'Conta | AgendaFlui' }

/** O que cada código de `?faltou=` quer dizer. O código vem da criação em etapas; nunca traz segredo. */
const FALTOU: Record<string, string> = {
  marca: 'a marca (cores, material e fontes)',
  logo: 'a logo',
  termos: 'os termos',
  modulos: 'os módulos',
  regras: 'as regras de agenda',
  chave: 'a chave de app',
}

// Página mínima: a tarefa 7 a substitui pela página completa da conta, com abas.
export default async function ContaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const admin = await requirePlatformAdmin()
  const { id } = await params
  const q = await searchParams
  let conta: Awaited<ReturnType<typeof getBusinessDetail>>
  try {
    conta = await getBusinessDetail(admin, id)
  } catch (err) {
    if (err instanceof DomainError && err.code === 'not_found') notFound()
    throw err
  }
  const bruto = Array.isArray(q.faltou) ? q.faltou[0] : q.faltou
  const faltou = (bruto ?? '')
    .split(',')
    .map((c) => FALTOU[c])
    .filter((t): t is string => t !== undefined)

  return (
    <DevFrame admin={admin} title={conta.name}>
      <Paper raised={1} className="af-listpanel">
        {faltou.length > 0 ? (
          <p role="alert" className="af-wizard__note">
            A conta foi criada, mas não deu para salvar {faltou.join(', ')}. Confira esses itens e salve de novo.
          </p>
        ) : null}
        <p>
          <StatusLamp status={conta.status} />
        </p>
        <div className="af-done__row">
          <span className="af-done__label">Link de entrada</span>
          <span className="af-entrylink">
            <span className="af-entrylink__url">{conta.entryUrl}</span>
            <CopyButton text={conta.entryUrl} label={`Copiar link de entrada de ${conta.name}`} />
          </span>
        </div>
        <p className="af-account__slug">
          Identificador: {conta.slug}. Dono: {conta.ownerName ?? 'sem dono ativo'}.
        </p>
        <div>
          <LinkButton href="/contas">Voltar às contas</LinkButton>
        </div>
      </Paper>
    </DevFrame>
  )
}
