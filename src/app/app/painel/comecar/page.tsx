import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { getOnboarding } from '@/server/domain/onboarding/progress'
import { getServiceSuggestions } from '@/server/domain/onboarding/steps'
import { getBusinessAppearance, getBusinessProfile } from '@/server/domain/settings/business-profile'
import { getCustomerLink } from '@/server/domain/settings/customer-link'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import { Card, Meter } from '@/ui/components'
import { porCodigo, um } from '@/app/_lib/params'
import { LOGO } from '../_lib/logo-mensagens'
import { PainelFrame } from '../PainelFrame'
import { FocoDoPasso } from './_passos/FocoDoPasso'
import { Navegacao } from './_passos/Navegacao'
import { PassoAnimais } from './_passos/PassoAnimais'
import { PassoEquipe } from './_passos/PassoEquipe'
import { PassoExpediente } from './_passos/PassoExpediente'
import { PassoLink } from './_passos/PassoLink'
import { PassoLoja } from './_passos/PassoLoja'
import { PassoMarca } from './_passos/PassoMarca'
import { PassoServicos } from './_passos/PassoServicos'
import { Trilho } from './_passos/Trilho'

export const metadata: Metadata = { title: 'Começar | Agenda Flui' }

/** O título e a frase de cada passo: curtos, com o verbo na frente. */
const TEXTO: Record<string, { titulo: string; frase: string }> = {
  loja: { titulo: 'Dados da loja', frase: 'Diga como sua loja se chama e como falar com ela.' },
  marca: { titulo: 'Marca', frase: 'Escolha a logo e as cores. A prévia muda na hora.' },
  animais: { titulo: 'Animais atendidos', frase: 'Escolha quem passa pela sua porta.' },
  servicos: { titulo: 'Serviços', frase: 'Ajuste os preços de exemplo, desmarque o que não faz ou adicione outro.' },
  expediente: { titulo: 'Expediente', frase: 'Defina quando você atende.' },
  equipe: { titulo: 'Equipe', frase: 'Convide quem trabalha com você. Este passo é opcional.' },
  link: { titulo: 'Link para clientes', frase: 'Tudo pronto. Compartilhe o link e receba os primeiros agendamentos.' },
}

export default async function ComecarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant('manage_account')
  const view = await getOnboarding(ctx)
  if (view === null) redirect('/painel')
  const q = await searchParams
  const pedido = um(q.passo)
  const atual = view.steps.find((s) => s.slug === pedido) ?? view.steps.find((s) => s.key === (view.current ?? 'LINK')) ?? view.steps[0]
  if (!atual) redirect('/painel')
  const indice = view.steps.findIndex((s) => s.key === atual.key)
  const anterior = indice > 0 ? view.steps[indice - 1] : undefined
  const texto = TEXTO[atual.slug] ?? { titulo: atual.label, frase: '' }

  let corpo
  switch (atual.key) {
    case 'STORE': {
      const p = await getBusinessProfile(ctx)
      corpo = <PassoLoja version={p.version} name={p.name} contactEmail={p.contactEmail ?? ''} contactPhone={p.phoneLabel ?? ''} />
      break
    }
    case 'BRAND': {
      const [a, p] = await Promise.all([getBusinessAppearance(ctx), getBusinessProfile(ctx)])
      corpo = (
        <PassoMarca
          version={a.version}
          storeName={p.name}
          primary={a.primary}
          accent={a.accent}
          material={a.material}
          logoUrl={a.logoUrl}
          logoAviso={porCodigo(LOGO, um(q.logo)) ?? null}
        />
      )
      break
    }
    case 'ANIMALS': {
      const n = await getNicheSettings(ctx)
      corpo = <PassoAnimais version={n.version} servesCats={n.options.servesCats} />
      break
    }
    case 'SERVICES': {
      const s = await getServiceSuggestions(ctx)
      corpo = (
        <PassoServicos
          rows={s.rows.map((r) => ({ name: r.name, icon: r.icon, description: r.description, exists: r.exists, prices: r.prices }))}
          slotStepMin={s.slotStepMin}
          portes={s.variants.map((v) => ({ key: v.key, shortLabel: v.shortLabel, rangeLabel: v.rangeLabel }))}
        />
      )
      break
    }
    case 'HOURS':
      corpo = <PassoExpediente />
      break
    case 'TEAM':
      corpo = <PassoEquipe />
      break
    case 'LINK': {
      const [link, p] = await Promise.all([getCustomerLink(ctx), getBusinessProfile(ctx)])
      corpo = link ? <PassoLink url={link.url} qrSvg={link.qrSvg} storeName={p.name} /> : null
      break
    }
  }

  return (
    <PainelFrame ctx={ctx} title="Começar">
      <div className="af-onb">
        <Card as="section" aria-labelledby="onb-progresso" className="af-onb__top">
          <div className="af-onb__top-head">
            <h2 id="onb-progresso" className="af-onb__top-title">
              Monte sua loja
            </h2>
            <p className="af-onb__top-text">Falta pouco. Cada passo leva menos de um minuto.</p>
          </div>
          <Meter className="af-onb__meter" label="Progresso do começo" value={view.total === 0 ? 0 : view.done / view.total} display={`${view.done} de ${view.total}`} />
          <Trilho steps={view.steps} atual={atual.slug} />
        </Card>
        <FocoDoPasso key={atual.key}>
          <Card as="section" aria-labelledby="onb-titulo" className="af-onb__card">
            <header className="af-onb__head">
              <p className="af-onb__kicker">
                Passo {indice + 1} de {view.total}
              </p>
              <h2 id="onb-titulo" tabIndex={-1} data-onb-title className="af-onb__title">
                {texto.titulo}
              </h2>
              <p className="af-onb__lead">{texto.frase}</p>
            </header>
            {corpo}
          </Card>
          <Navegacao passo={atual.key} pular={atual.key !== 'LINK'} voltar={anterior ? `/painel/comecar?passo=${anterior.slug}` : null} />
        </FocoDoPasso>
      </div>
    </PainelFrame>
  )
}
