import type { Metadata } from 'next'
import { can } from '@/server/auth/capabilities'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getOwnAccountProfile } from '@/server/domain/account/profile'
import { getBusinessAppearance, getBusinessProfile, getTerms } from '@/server/domain/settings/business-profile'
import { listClosuresFor } from '@/server/domain/settings/closures'
import { getNotificationSettingsView } from '@/server/domain/settings/notification-settings'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { getSchedulingRules, RULE_LIMITS, SLOT_STEPS } from '@/server/domain/settings/scheduling-rules'
import { addDays, todayIn } from '@/server/time'
import { BrandPreview, Button, Card, EmptyHint, NavTabs } from '@/ui/components'
import { ACCENT_FIELD_LABEL, labelOf, PRIMARY_FIELD_LABEL, SIDEBAR_FIELD_LABEL, SIDEBAR_OPTIONS } from '@/shared/theme/labels'
import { tiposDeAviso } from '@/app/_lib/avisos'
import { porCodigo, um } from '@/app/_lib/params'
import { PainelFrame } from '../PainelFrame'
import { AvisosForm, FechamentoForm, FechamentosLista, NegocioForm, PerfilForm, RegrasForm, SenhaForm, TermosForm } from './Formularios'

export const metadata: Metadata = { title: 'Configurações | Agenda Flui' }

type Secao = 'negocio' | 'aparencia' | 'agenda' | 'fechamentos' | 'avisos' | 'termos' | 'perfil'

const LOGO: Record<string, { texto: string; ok: boolean }> = {
  ok: { texto: 'Logo atualizada.', ok: true },
  no_file: { texto: 'Escolha uma imagem antes de enviar.', ok: false },
  too_large: { texto: 'A imagem passa de 8 MB. Escolha um arquivo menor.', ok: false },
  not_an_image: { texto: 'Este arquivo não é uma imagem. Envie JPEG, PNG ou WebP.', ok: false },
  unsupported_format: { texto: 'Este formato não é aceito. Envie JPEG, PNG ou WebP.', ok: false },
  too_many_pixels: { texto: 'A imagem é grande demais. Reduza e envie de novo.', ok: false },
  too_small: { texto: 'A imagem é pequena demais. Escolha outra.', ok: false },
  forbidden: { texto: 'Só o dono da conta troca a logo.', ok: false },
  refused: { texto: 'Não foi possível trocar a logo. Tente outra imagem.', ok: false },
}

const caixa = (v: boolean): string => (v ? 'on' : '')

export default async function ConfiguracoesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireTenant()
  const q = await searchParams
  const donoDaConta = can(ctx.actor, 'manage_account')
  const gerencia = can(ctx.actor, 'manage_settings')
  const painel = await getPainelContext(ctx)
  const { terms } = painel

  const secoes: { id: Secao; label: string }[] = [
    ...(donoDaConta ? [{ id: 'negocio' as const, label: 'Negócio' }, { id: 'aparencia' as const, label: 'Aparência' }] : []),
    ...(gerencia
      ? [
          { id: 'agenda' as const, label: 'Agenda' },
          { id: 'fechamentos' as const, label: 'Fechamentos' },
          { id: 'avisos' as const, label: 'Avisos' },
          { id: 'termos' as const, label: 'Termos' },
        ]
      : []),
    { id: 'perfil' as const, label: 'Meu perfil' },
  ]
  const pedida = um(q.secao)
  const secao: Secao = secoes.find((s) => s.id === pedida)?.id ?? secoes[0]?.id ?? 'perfil'
  const titulo = gerencia ? 'Configurações' : 'Meu perfil'

  let corpo
  if (secao === 'negocio') {
    const p = await getBusinessProfile(ctx)
    corpo = (
      <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
        <h2 id="cfg-titulo" className="af-section__title">
          Dados do negócio
        </h2>
        <NegocioForm version={p.version} name={p.name} contactEmail={p.contactEmail ?? ''} contactPhone={p.phoneLabel ?? ''} />
      </Card>
    )
  } else if (secao === 'aparencia') {
    const [a, perfil] = await Promise.all([getBusinessAppearance(ctx), getBusinessProfile(ctx)])
    const logo = porCodigo(LOGO, um(q.logo))
    corpo = (
      <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
        <h2 id="cfg-titulo" className="af-section__title">
          Aparência
        </h2>
        <form method="post" action="/configuracoes/logo" encType="multipart/form-data" className="af-acctform">
          <div className="af-field">
            <label htmlFor="cfg-logo" className="af-field__label">
              Logo
            </label>
            <p className="af-field__hint">Aparece na barra lateral e na entrada. JPEG, PNG ou WebP, até 8 MB.</p>
            {a.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagem da conta servida pela rota /arquivos
              <img src={a.logoUrl} alt="Logo atual" className="af-imgslot__img" />
            ) : (
              <EmptyHint>Sem logo. O nome do negócio aparece no lugar.</EmptyHint>
            )}
            <input id="cfg-logo" type="file" name="file" accept="image/png,image/jpeg,image/webp" className="af-input" />
          </div>
          <div className="af-acctform__foot">
            <Button type="submit" variant="primary">
              Enviar logo
            </Button>
            {a.logoUrl ? (
              <Button type="submit" name="intent" value="remove" formNoValidate>
                Remover logo
              </Button>
            ) : null}
            {logo ? (
              <p role={logo.ok ? 'status' : 'alert'} className={logo.ok ? 'af-acctform__ok' : 'af-field__error'}>
                {logo.texto}
              </p>
            ) : null}
          </div>
        </form>
        <dl className="af-settings__readonly">
          <div>
            <dt>{PRIMARY_FIELD_LABEL}</dt>
            <dd>
              <span className="af-settings__swatch" style={{ backgroundColor: a.primary }} aria-hidden="true" />
              {a.primary}
            </dd>
          </div>
          <div>
            <dt>{ACCENT_FIELD_LABEL}</dt>
            <dd>
              <span className="af-settings__swatch" style={{ backgroundColor: a.accent }} aria-hidden="true" />
              {a.accent}
            </dd>
          </div>
          <div>
            <dt>{SIDEBAR_FIELD_LABEL}</dt>
            <dd>{labelOf(SIDEBAR_OPTIONS, a.material)}</dd>
          </div>
        </dl>
        <p className="af-section__help">As cores e a barra lateral são ajustados pela equipe do Agenda Flui. Para mudar, fale com o suporte.</p>
        <BrandPreview businessName={perfil.name} brand={a} terms={terms} />
      </Card>
    )
  } else if (secao === 'agenda') {
    const r = await getSchedulingRules(ctx)
    corpo = (
      <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
        <h2 id="cfg-titulo" className="af-section__title">
          Regras da agenda
        </h2>
        <RegrasForm
          version={r.version}
          grades={SLOT_STEPS}
          limites={RULE_LIMITS}
          valores={{
            slotStepMin: String(r.slotStepMin),
            minLeadMin: String(r.minLeadMin),
            maxAdvanceDays: String(r.maxAdvanceDays),
            customerChangeWindowMin: String(r.customerChangeWindowMin),
            bufferMin: String(r.bufferMin),
            autoConfirm: caixa(r.autoConfirm),
          }}
        />
      </Card>
    )
  } else if (secao === 'fechamentos') {
    const hoje = todayIn(ctx.timeZone, ctx.clock())
    const lista = await listClosuresFor(ctx, { from: hoje, to: addDays(hoje, 399) })
    corpo = (
      <>
        <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
          <h2 id="cfg-titulo" className="af-section__title">
            Fechamentos
          </h2>
          <p className="af-section__help">Dias em que o negócio não abre. Os agendamentos que já existem nesses dias não são cancelados.</p>
          <FechamentosLista fechamentos={lista.map((f) => ({ id: f.id, label: f.label, reason: f.reason ?? null }))} />
        </Card>
        <Card as="section" aria-labelledby="cfg-novo" className="af-settings__section">
          <h2 id="cfg-novo" className="af-section__title">
            Novo fechamento
          </h2>
          <FechamentoForm hoje={hoje} />
        </Card>
      </>
    )
  } else if (secao === 'avisos') {
    const { settings, version } = await getNotificationSettingsView(ctx)
    const lista = tiposDeAviso()
    const valores: Record<string, string> = {}
    for (const a of lista) {
      const canais = settings[a.kind as keyof typeof settings]
      valores[`${a.kind}__email`] = caixa(canais.email)
      valores[`${a.kind}__push`] = caixa(canais.push)
    }
    corpo = (
      <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
        <h2 id="cfg-titulo" className="af-section__title">
          Avisos
        </h2>
        <p className="af-section__help">Desmarcar um canal para de mandar aquele aviso por ele.</p>
        <AvisosForm version={version} valores={valores} avisos={lista} />
      </Card>
    )
  } else if (secao === 'termos') {
    const { terms: t, version } = await getTerms(ctx)
    corpo = (
      <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
        <h2 id="cfg-titulo" className="af-section__title">
          Termos
        </h2>
        <p className="af-section__help">As palavras que o painel e o aplicativo usam no lugar de &quot;profissional&quot; e &quot;cliente&quot;.</p>
        <TermosForm version={version} valores={{ ...t }} />
      </Card>
    )
  } else {
    let eu: Awaited<ReturnType<typeof getOwnAccountProfile>> | null = null
    try {
      eu = await getOwnAccountProfile(ctx)
    } catch (err) {
      if (!(err instanceof DomainError) || err.code !== 'forbidden') throw err
    }
    corpo = eu ? (
      <>
        <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
          <h2 id="cfg-titulo" className="af-section__title">
            Meu perfil
          </h2>
          <PerfilForm name={eu.name} email={eu.email} />
        </Card>
        <Card as="section" aria-labelledby="cfg-senha" className="af-settings__section">
          <h2 id="cfg-senha" className="af-section__title">
            Senha
          </h2>
          <SenhaForm />
        </Card>
      </>
    ) : (
      <Card as="section" aria-labelledby="cfg-titulo" className="af-settings__section">
        <h2 id="cfg-titulo" className="af-section__title">
          Meu perfil
        </h2>
        <EmptyHint>Em modo suporte não há perfil nem senha para mudar. Eles ficam disponíveis para quem entra com o próprio acesso.</EmptyHint>
      </Card>
    )
  }

  return (
    <PainelFrame ctx={ctx} title={titulo}>
      <div className="af-settings">
        {secoes.length > 1 ? <NavTabs label="Seções das configurações" items={secoes.map((s) => ({ id: s.id, label: s.label, href: `/configuracoes?secao=${s.id}`, active: secao === s.id }))} /> : null}
        {corpo}
      </div>
    </PainelFrame>
  )
}
