import type { Metadata } from 'next'
import { requirePerson } from '@/server/auth/guards'
import { getPersonAccount } from '@/server/auth/person-account'
import { Button } from '@/ui/components'
import { AccountShell } from '@/ui/shells'
import { LogOut } from 'lucide-react'
import { GoogleAviso } from '../google/GoogleAviso'
import { sair } from './actions'
import { AvisosSecao } from './_partes/AvisosSecao'
import { DadosForm } from './_partes/DadosForm'
import { EmailForm } from './_partes/EmailForm'
import { GoogleSecao } from './_partes/GoogleSecao'
import { LojasSecao } from './_partes/LojasSecao'
import { SenhaForm } from './_partes/SenhaForm'

export const metadata: Metadata = { title: 'Minha conta | Agenda Flui' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** Minha conta: o que é da pessoa (dados, e-mail, senha, Google), os avisos da equipe e a troca de loja do cliente. */
export default async function ContaPage({ searchParams }: Props) {
  const sessao = await requirePerson()
  const conta = await getPersonAccount(sessao.user.id, sessao.customerBusinessId)
  const bruto = (await searchParams)['google']
  const codigo = typeof bruto === 'string' ? bruto : ''
  const lojaAtual = conta.stores.find((s) => s.current) ?? conta.stores[0] ?? null
  const voltar = conta.staff
    ? { href: '/painel', label: 'Voltar ao painel' }
    : lojaAtual
      ? { href: `/${lojaAtual.slug}`, label: 'Voltar à loja' }
      : null
  return (
    <AccountShell title="Minha conta" back={voltar}>
      <DadosForm name={conta.name} phoneLabel={conta.phoneLabel} shared={conta.stores.length > 0} />
      <EmailForm email={conta.email} google={conta.google ? { email: conta.google.email } : null} hasPassword={conta.hasPassword} />
      <SenhaForm hasPassword={conta.hasPassword} />
      {conta.googleAvailable || conta.google ? (
        <GoogleSecao
          google={conta.google ? { email: conta.google.email } : null}
          hasPassword={conta.hasPassword}
          email={conta.email}
          aviso={codigo ? <GoogleAviso codigo={codigo} /> : null}
        />
      ) : null}
      {conta.staff?.canWatchAll ? <AvisosSecao businessName={conta.staff.businessName} watchAll={conta.staff.watchAll} /> : null}
      {conta.stores.length >= 2 ? <LojasSecao stores={conta.stores} /> : null}
      <div className="af-conta__foot">
        <form action={sair}>
          <Button type="submit" variant="ghost" icon={<LogOut size={18} />}>
            Sair
          </Button>
        </form>
      </div>
    </AccountShell>
  )
}
