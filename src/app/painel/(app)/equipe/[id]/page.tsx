import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireTenant } from '@/server/auth/guards'
import { DomainError } from '@/server/domain/errors'
import { getPainelContext } from '@/server/domain/settings/painel-context'
import { accessStatus } from '@/server/domain/team/access-status'
import { getTeamSheet } from '@/server/domain/team/sheet'
import type { TeamSheet } from '@/server/domain/team/sheet'
import { formatDateTime } from '@/server/time'
import { Avatar, AvatarUpload, Card, EmptyState, LinkButton, NavTabs, StatusDot } from '@/ui/components'
import { weekFromMinutes } from '@/ui/week'
import { formatPercentInput } from '@/shared/percent'
import { um, porCodigo } from '@/app/_lib/params'
import { PainelFrame } from '../../PainelFrame'
import { AcessoGestao, BloqueioForm, BloqueiosLista, ConviteForm, DadosForm, ExpedienteForm, RemoverProfissional, ServicosForm } from '../FichaForms'

export const metadata: Metadata = { title: 'Ficha | Agenda Flui' }

const ABAS = [
  { id: 'dados', label: 'Dados' },
  { id: 'servicos', label: 'Serviços' },
  { id: 'expediente', label: 'Expediente' },
  { id: 'bloqueios', label: 'Bloqueios' },
  { id: 'acesso', label: 'Acesso' },
] as const
type Aba = (typeof ABAS)[number]['id']
/** O profissional, na própria ficha, só vê estas. */
const ABAS_DO_PROFISSIONAL: readonly Aba[] = ['expediente', 'bloqueios']

const FOTO: Record<string, { texto: string; ok: boolean }> = {
  ok: { texto: 'Foto atualizada.', ok: true },
  no_file: { texto: 'Escolha uma imagem antes de enviar.', ok: false },
  too_large: { texto: 'A foto passa de 8 MB. Escolha um arquivo menor.', ok: false },
  not_an_image: { texto: 'Este arquivo não é uma imagem. Envie JPEG, PNG ou WebP.', ok: false },
  unsupported_format: { texto: 'Este formato não é aceito. Envie JPEG, PNG ou WebP.', ok: false },
  too_many_pixels: { texto: 'A imagem é grande demais. Reduza e envie de novo.', ok: false },
  too_small: { texto: 'A imagem é pequena demais. Escolha outra.', ok: false },
  refused: { texto: 'Você não tem permissão para trocar esta foto.', ok: false },
  not_found: { texto: 'Esta ficha não existe mais.', ok: false },
}

export default async function FichaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireTenant('view_own_agenda')
  const { id } = await params
  const q = await searchParams

  let ficha: TeamSheet
  try {
    ficha = await getTeamSheet(ctx, id)
  } catch (err) {
    if (err instanceof DomainError && (err.code === 'not_found' || err.code === 'forbidden')) notFound()
    throw err
  }
  const painel = await getPainelContext(ctx)
  const { terms } = painel
  const p = ficha.professional
  const abasVisiveis = ABAS.filter((a) => ficha.fullAccess || ABAS_DO_PROFISSIONAL.includes(a.id))
  const pedida = um(q.aba)
  const aba: Aba = abasVisiveis.find((a) => a.id === pedida)?.id ?? abasVisiveis[0]?.id ?? 'expediente'
  const foto = porCodigo(FOTO, um(q.foto))
  const suporte = ctx.actor.kind === 'impersonator'
  const donoLogado = ctx.actor.kind === 'member' ? ctx.actor.role === 'OWNER' : suporte
  const bloqueios = ficha.blocks.map((b) => ({
    id: b.id,
    quando: `${formatDateTime(b.startsAt, ficha.timeZone)} até ${formatDateTime(b.endsAt, ficha.timeZone)}`,
    motivo: b.reason,
  }))
  const acesso = ficha.access

  return (
    <PainelFrame
      ctx={ctx}
      title={p.name}
      actions={
        ficha.fullAccess ? (
          <LinkButton href="/equipe" variant="ghost">
            Voltar para {terms.professionalPlural.toLowerCase()}
          </LinkButton>
        ) : null
      }
    >
      <div className="af-profile">
        <Card as="section" aria-label="Resumo da ficha" className="af-profile">
          <div className="af-profile__head">
            <Avatar name={p.name} src={p.avatarUrl} size="lg" />
            <div className="af-profile__meta">
              {p.archived ? <StatusDot tone="neutral" label="Ficha arquivada" /> : p.active ? <StatusDot tone="success" label="Disponível para marcar" /> : <StatusDot tone="warning" label="Fora de uso" detail="Não aparece para marcar" />}
            </div>
          </div>
          {foto ? (
            <p role={foto.ok ? 'status' : 'alert'} className={foto.ok ? 'af-acctform__ok' : 'af-rowerror'}>
              {foto.texto}
            </p>
          ) : null}
          {p.archived ? null : (
            <details className="af-profile__photo">
              <summary>Trocar a foto</summary>
              <AvatarUpload action={`/equipe/${p.id}/foto`} name={p.name} src={p.avatarUrl} />
            </details>
          )}
        </Card>

        {abasVisiveis.length > 1 ? (
          <NavTabs label="Seções da ficha" items={abasVisiveis.map((a) => ({ id: a.id, label: a.label, href: `/equipe/${p.id}?aba=${a.id}`, active: aba === a.id }))} />
        ) : null}

        {p.archived ? (
          <Card as="section" aria-label="Ficha arquivada">
            <EmptyState title="Esta ficha está arquivada" description="Ela não aparece para marcar horário nem aceita alterações. Restaure a ficha para voltar a usá-la." />
          </Card>
        ) : aba === 'dados' ? (
          <>
            <Card as="section" aria-labelledby="ficha-dados" className="af-profile">
              <h2 id="ficha-dados" className="af-section__title">
                Dados e comissão
              </h2>
              <DadosForm id={p.id} name={p.name} bio={p.bio ?? ''} commission={formatPercentInput(p.commissionBps ?? 0)} active={p.active === true} termo={terms.professionalSingular} />
            </Card>
            <Card as="section" aria-labelledby="ficha-remover" className="af-profile">
              <h2 id="ficha-remover" className="af-section__title">
                Cuidados com a ficha
              </h2>
              <RemoverProfissional id={p.id} nome={p.name} singular={terms.professionalSingular} temAcesso={acesso !== null && acesso.active} />
            </Card>
          </>
        ) : aba === 'servicos' ? (
          <Card as="section" aria-labelledby="ficha-servicos" className="af-profile">
            <h2 id="ficha-servicos" className="af-section__title">
              Serviços que {p.name} faz
            </h2>
            <ServicosForm id={p.id} servicos={ficha.services} />
          </Card>
        ) : aba === 'expediente' ? (
          <Card as="section" aria-labelledby="ficha-expediente" className="af-profile">
            <h2 id="ficha-expediente" className="af-section__title">
              Expediente da semana
            </h2>
            <p className="af-section__help">Os horários em que {ficha.own ? 'você atende' : `${p.name} atende`}, no fuso da conta. Dia sem faixa fica fechado.</p>
            <ExpedienteForm id={p.id} week={weekFromMinutes(ficha.week)} />
          </Card>
        ) : aba === 'bloqueios' ? (
          <>
            <Card as="section" aria-labelledby="ficha-bloqueios" className="af-profile">
              <h2 id="ficha-bloqueios" className="af-section__title">
                Próximos bloqueios
              </h2>
              <BloqueiosLista bloqueios={bloqueios} />
            </Card>
            <Card as="section" aria-labelledby="ficha-novo-bloqueio" className="af-profile">
              <h2 id="ficha-novo-bloqueio" className="af-section__title">
                Bloquear um horário
              </h2>
              <BloqueioForm id={p.id} hoje={ficha.today} />
            </Card>
          </>
        ) : (
          <Card as="section" aria-labelledby="ficha-acesso" className="af-profile">
            <h2 id="ficha-acesso" className="af-section__title">
              Acesso ao painel
            </h2>
            {acesso ? (
              <AcessoGestao
                acesso={{ membershipId: acesso.membershipId, email: acesso.email, name: acesso.name, role: acesso.role, status: accessStatus(acesso) }}
                suporte={suporte}
                podeDono={donoLogado}
                termo={terms.professionalSingular}
                nomeFicha={p.name}
              />
            ) : (
              <ConviteForm id={p.id} nome={p.name} podeConvidarDono={donoLogado} termo={terms.professionalSingular} />
            )}
          </Card>
        )}
      </div>
    </PainelFrame>
  )
}
