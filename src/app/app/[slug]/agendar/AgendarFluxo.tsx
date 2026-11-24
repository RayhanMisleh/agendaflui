'use client'
import { useCallback, useEffect, useMemo, useReducer } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Button, ProgressBar, StepStage } from '@/ui/components'
import { formatDuration, formatLongDate, formatMoney } from '@/ui/format'
import type { EstadoCliente } from '../_lib/estado'
import { marcarHorario, remarcarHorario } from './actions'
import { diasLivres, horariosLivres, profissionaisPara, servicosDoPet } from './consultas'
import { fluxoReducer, iniciarFluxo, novaChave, type Sugestao } from './fluxo'
import { PassoConfirmar } from './_passos/PassoConfirmar'
import { PassoHorario } from './_passos/PassoHorario'
import { PassoPet } from './_passos/PassoPet'
import { PassoProfissional } from './_passos/PassoProfissional'
import { PassoServicos } from './_passos/PassoServicos'
import type { Consultas, PetDoFluxo } from './tipos'
import { useConsulta } from './use-consulta'

export type RemarcacaoDoFluxo = { id: string; petId: string | null; petName: string | null; serviceIds: string[]; services: { name: string; priceCents: number }[]; totalCents: number; professionalId: string; professionalName: string }

export type AgendarFluxoProps = {
  slug: string
  /** Hoje, no fuso da loja (`AAAA-MM-DD`). */
  today: string
  pets: PetDoFluxo[]
  modo: 'novo' | 'remarcar'
  inicial?: { petId?: string | null; serviceIds?: string[]; professionalId?: string | null; singleProfessional?: boolean }
  remarcacao?: RemarcacaoDoFluxo
  /** Para teste: troca as consultas ao servidor. */
  consultas?: Consultas
}

function consultasDe(slug: string): Consultas {
  return {
    servicos: (petId) => servicosDoPet(slug, petId),
    profissionais: (ids) => profissionaisPara(slug, ids),
    dias: (q) => diasLivres(slug, q),
    horarios: (q) => horariosLivres(slug, q),
  }
}

/**
 * O Agendar do cliente (e o Remarcar): um passo por tela, com barra de progresso e a barra "Continuar" que sobe quando há
 * escolha válida. O estado todo está no redutor puro (`fluxo.ts`). A marcação é uma ação de servidor com a chave de
 * idempotência do fluxo; se o horário foi tomado, o fluxo volta ao passo do horário com sugestões, mantendo o resto.
 */
export function AgendarFluxo(p: AgendarFluxoProps) {
  const consultas = useMemo(() => p.consultas ?? consultasDe(p.slug), [p.consultas, p.slug])
  const remarcando = p.modo === 'remarcar' && p.remarcacao !== undefined
  const [s, dispatch] = useReducer(fluxoReducer, undefined, () =>
    iniciarFluxo({
      key: novaChave(),
      modo: p.modo,
      pets: p.pets.map((x) => ({ id: x.id, bookable: x.bookable })),
      ...(remarcando && p.remarcacao
        ? { petId: p.remarcacao.petId, serviceIds: p.remarcacao.serviceIds, professionalId: p.remarcacao.professionalId }
        : (p.inicial ?? {})),
    }),
  )

  const pet = p.pets.find((x) => x.id === s.petId) ?? null
  const petRotulo = pet ? pet.typeLabel : null

  // Os serviços do pet (preço e tempo do porte): lidos uma vez por pet e usados no passo, no total e no resumo.
  const buscarServicos = useCallback(() => consultas.servicos(s.petId ?? ''), [consultas, s.petId])
  const servicos = useConsulta(p.modo === 'novo' && (s.petId !== null || p.pets.length === 0) ? buscarServicos : null)
  const idsChave = s.serviceIds.join(',')
  const buscarProfissionais = useCallback(() => consultas.profissionais(idsChave === '' ? [] : idsChave.split(',')), [consultas, idsChave])
  const profissionais = useConsulta(idsChave === '' ? null : buscarProfissionais)

  const catalogo = servicos.pedido?.ok ? servicos.pedido.servicos : []
  const escolhidos = remarcando && p.remarcacao ? p.remarcacao.services : s.serviceIds.flatMap((id) => catalogo.filter((c) => c.id === id).map((c) => ({ name: c.name, priceCents: c.priceCents })))
  const totalCents = remarcando && p.remarcacao ? p.remarcacao.totalCents : s.serviceIds.length > 0 && escolhidos.length === s.serviceIds.length ? escolhidos.reduce((t, x) => t + x.priceCents, 0) : null
  const minutos = s.serviceIds.reduce((t, id) => t + (catalogo.find((c) => c.id === id)?.durationMin ?? 0), 0)

  const nomeProfissional = !s.professionalChosen
    ? ''
    : s.professionalId === null
      ? 'Qualquer um'
      : (profissionais.pedido?.ok ? profissionais.pedido.profissionais.find((x) => x.id === s.professionalId)?.name : undefined) ?? (remarcando && p.remarcacao?.professionalId === s.professionalId ? p.remarcacao.professionalName : 'Profissional')
  const quando = s.startsAt && s.date ? `${formatLongDate(s.date)}, ${s.startsLabel ?? ''}` : ''

  // Marcar: a ação devolve `conflict` quando o horário foi tomado; o fluxo volta ao passo do horário com as sugestões.
  const acaoMarcar = remarcando ? remarcarHorario : marcarHorario
  const enviar = useCallback(
    async (prev: EstadoCliente, fd: FormData): Promise<EstadoCliente> => {
      const r = await acaoMarcar(p.slug, prev, fd)
      if (r.conflict) {
        const sugestoes: Sugestao[] = r.conflict.nearest.map((n) => ({ iso: n.iso, label: n.label, date: n.date }))
        dispatch({ type: 'ocupado', message: r.message ?? 'Esse horário acabou de ser ocupado. Escolha outro.', sugestoes })
      }
      return r
    },
    [acaoMarcar, p.slug],
  )

  const primeiro = s.passos[0] === s.passo
  const sair = remarcando && p.remarcacao ? `/${p.slug}/horarios/${p.remarcacao.id}` : `/${p.slug}`
  const resumoDaBarra = (() => {
    switch (s.passo) {
      case 'pet':
        return pet?.name ?? ''
      case 'servicos':
        return totalCents !== null ? `Total ${formatMoney(totalCents)}${minutos > 0 ? ` · ${formatDuration(minutos)}` : ''}` : `${s.serviceIds.length} ${s.serviceIds.length === 1 ? 'serviço' : 'serviços'}`
      case 'profissional':
        return nomeProfissional
      case 'horario':
        return quando
      default:
        return ''
    }
  })()
  const barra = s.passo !== 'confirmar' && ((s.passo === 'pet' && s.petId !== null) || (s.passo === 'servicos' && s.serviceIds.length > 0) || (s.passo === 'profissional' && s.professionalChosen) || (s.passo === 'horario' && s.startsAt !== null))

  const escopo = {
    serviceIds: remarcando ? [] : s.serviceIds,
    petId: s.petId ?? '',
    professionalId: s.professionalId,
    rescheduling: remarcando && p.remarcacao ? p.remarcacao.id : null,
  }

  return (
    <div className="af-cl-quiz af-cl-flow">
      <div className="af-cl-quiz__top">
        {primeiro ? (
          <Link href={sair} className="af-cl-quiz__back" aria-label="Sair do agendamento">
            <ChevronLeft size={22} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" className="af-cl-quiz__back" aria-label="Voltar" onClick={() => dispatch({ type: 'voltar' })}>
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
        )}
        <ProgressBar value={s.passos.indexOf(s.passo) + 1} max={s.passos.length} label={remarcando ? 'Progresso da remarcação' : 'Progresso do agendamento'} />
      </div>
      <StepStage stepKey={s.passo} direction={s.direction}>
        {s.passo === 'pet' ? <PassoPet slug={p.slug} pets={p.pets} petId={s.petId} onEscolher={(id) => dispatch({ type: 'pet', petId: id })} /> : null}
        {s.passo === 'servicos' ? (
          <PassoServicos pedido={servicos.pedido} tentar={servicos.tentar} escolhidos={s.serviceIds} petRotulo={petRotulo} onAlternar={(id) => dispatch({ type: 'servico', serviceId: id })} />
        ) : null}
        {s.passo === 'profissional' ? (
          <PassoProfissionalAuto
            pedido={profissionais.pedido}
            tentar={profissionais.tentar}
            escolhido={s.professionalId}
            decidido={s.professionalChosen}
            unico={p.modo === 'novo' || remarcando}
            onEscolher={(id) => dispatch({ type: 'profissional', id })}
            onUnico={(id) => dispatch({ type: 'unico', id })}
          />
        ) : null}
        {s.passo === 'horario' ? (
          <PassoHorario
            consultas={consultas}
            today={p.today}
            escopo={escopo}
            date={s.date}
            startsAt={s.startsAt}
            aviso={s.aviso}
            sugestoes={s.sugestoes}
            onDia={(date) => dispatch({ type: 'dia', date })}
            onHorario={(iso, label) => dispatch({ type: 'horario', iso, label })}
          />
        ) : null}
        {s.passo === 'confirmar' ? (
          <PassoConfirmar
            action={enviar}
            remarcar={remarcando}
            note={s.note}
            onNote={(text) => dispatch({ type: 'nota', text })}
            hidden={
              remarcando && p.remarcacao
                ? { appointmentId: p.remarcacao.id, startsAt: s.startsAt ?? '', professionalId: s.professionalId ?? '' }
                : { petId: s.petId ?? '', professionalId: s.professionalId ?? '', startsAt: s.startsAt ?? '', key: s.key }
            }
            repetidos={{ name: 'serviceIds', values: remarcando ? [] : s.serviceIds }}
            resumo={{ pet: remarcando && p.remarcacao ? p.remarcacao.petName : (pet?.name ?? null), servicos: escolhidos, totalCents, profissional: nomeProfissional, quando }}
          />
        ) : null}
      </StepStage>
      {barra ? (
        <div className="af-cl-bar">
          <p className="af-cl-bar__summary" aria-live="polite">
            {resumoDaBarra}
          </p>
          <Button variant="primary" size="lg" onClick={() => dispatch({ type: 'avancar' })}>
            Continuar
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** O passo do profissional; com um só profissional que faz tudo, escolhe por quem agenda e segue ao horário. */
function PassoProfissionalAuto(p: {
  pedido: Parameters<typeof PassoProfissional>[0]['pedido']
  tentar: () => void
  escolhido: string | null
  decidido: boolean
  unico: boolean
  onEscolher: (id: string | null) => void
  onUnico: (id: string) => void
}) {
  const unicoId = p.unico && p.pedido?.ok && p.pedido.profissionais.length === 1 ? (p.pedido.profissionais[0]?.id ?? null) : null
  const { decidido, onUnico } = p
  useEffect(() => {
    if (unicoId !== null && !decidido) onUnico(unicoId)
  }, [unicoId, decidido, onUnico])
  return <PassoProfissional pedido={p.pedido} tentar={p.tentar} escolhido={p.escolhido} decidido={p.decidido} onEscolher={p.onEscolher} />
}
