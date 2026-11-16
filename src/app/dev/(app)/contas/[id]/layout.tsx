import type { ReactNode } from 'react'
import { DoorOpen } from 'lucide-react'
import { Button, CopyButton, LinkButton, NavTabs, Paper, StatusLamp } from '@/ui/components'
import { DevFrame } from '../../DevFrame'
import { carregarConta } from './_data'
import { StatusMenu } from './StatusMenu'
import { accountTabs } from './tabs'

/** Cabeçalho da conta (carrega uma vez): nome, situação, link de entrada, "Entrar como", menu de situação e as abas. */
export default async function ContaLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params
  const { admin, conta } = await carregarConta(id)
  return (
    <DevFrame
      admin={admin}
      title={conta.name}
      actions={
        <LinkButton href="/contas" variant="ghost">
          Voltar às contas
        </LinkButton>
      }
    >
      <Paper raised={1} className="af-acct">
        <div className="af-acct__row">
          <StatusLamp status={conta.status} />
          <span className="af-account__slug">
            Identificador {conta.slug}. Dono: {conta.ownerName ?? 'sem dono ativo'}.
          </span>
        </div>
        <div className="af-acct__row">
          <span className="af-done__label">Link de entrada</span>
          <span className="af-entrylink">
            <span className="af-entrylink__url">{conta.entryUrl}</span>
            <CopyButton text={conta.entryUrl} label={`Copiar link de entrada de ${conta.name}`} />
          </span>
        </div>
        <div className="af-acct__actions">
          {conta.status === 'ARCHIVED' ? (
            <Button disabled title="Reative a conta para entrar como suporte." icon={<DoorOpen size={18} />}>
              Entrar como
            </Button>
          ) : (
            // POST de formulário (nunca link GET com efeito colateral); abre o painel da conta em nova aba.
            <form method="post" action={`/contas/${conta.id}/entrar`} target="_blank">
              <Button type="submit" icon={<DoorOpen size={18} />} aria-label={`Entrar como suporte em ${conta.name}, em nova aba`}>
                Entrar como
              </Button>
            </form>
          )}
          <StatusMenu key={conta.status} businessId={conta.id} name={conta.name} status={conta.status} />
        </div>
      </Paper>
      <NavTabs label="Abas da conta" items={accountTabs(conta.id)} />
      {children}
    </DevFrame>
  )
}
