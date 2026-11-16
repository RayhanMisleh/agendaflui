import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { requireMemberSession } from '@/server/auth/guards'
import { roleLabel } from '@/server/auth/role-labels'
import { tenantDb } from '@/server/db/tenant'
import { getPublicBrandById } from '@/server/domain/platform/branding'
import { cx } from '@/ui/components/cx'
import { ThemeScope } from '@/ui/theme/ThemeScope'
import { AGENDAFLUI_BRAND } from '@/ui/theme/default-brand'
import { deriveTheme } from '@/ui/theme/derive'
import { EntryScreen } from '@/ui/shells'
import { chooseBusiness } from './actions'
import { SairDaConta } from '../SairDaConta'

export const metadata: Metadata = { title: 'Escolher conta | AgendaFlui' }

const THEME = deriveTheme(AGENDAFLUI_BRAND)

export default async function EscolherContaPage() {
  const session = await requireMemberSession()
  // Suporte não escolhe conta: a conta é a da sessão.
  if (session.kind === 'support') redirect('/')
  const contas = await Promise.all(
    session.memberships.map(async (m) => {
      const [marca, termos] = await Promise.all([
        getPublicBrandById(m.businessId),
        tenantDb(m.businessId).businessSettings.findFirst({ select: { termProfessionalSingular: true } }),
      ])
      return marca ? { businessId: m.businessId, marca, papel: roleLabel(m.role, termos?.termProfessionalSingular ?? 'Profissional') } : null
    }),
  )
  const disponiveis = contas.filter((c) => c !== null)

  return (
    <EntryScreen
      theme={THEME}
      brand={{ name: 'AgendaFlui', logoUrl: null, symbolUrl: null }}
      title="Escolha a conta"
      message={disponiveis.length > 0 ? `Olá, ${session.user.name.split(' ')[0]}. Em qual agenda você quer entrar?` : null}
      testId="escolher-conta"
      wide
    >
      {disponiveis.length > 0 ? (
        <ul className="af-choices">
          {disponiveis.map((c) => (
            <li key={c.businessId}>
              <ThemeScope theme={c.marca.theme}>
                <form action={chooseBusiness}>
                  <input type="hidden" name="businessId" value={c.businessId} />
                  <button type="submit" className={cx('af-choice af-cover af-stitched')}>
                    <span className="af-choice__text">
                      <span className="af-choice__name af-engraved">{c.marca.name}</span>
                      <span className="af-choice__role af-on-cover-text">{c.papel}</span>
                    </span>
                    <ChevronRight className="af-choice__go" size={22} aria-hidden="true" />
                  </button>
                </form>
              </ThemeScope>
            </li>
          ))}
        </ul>
      ) : (
        <div className="af-entry__form">
          <p className="af-entry__error" role="alert">
            Seu acesso não está ligado a nenhuma conta ativa. Fale com quem administra o seu negócio.
          </p>
        </div>
      )}
      <div className="af-entry__form">
        <SairDaConta />
      </div>
    </EntryScreen>
  )
}
