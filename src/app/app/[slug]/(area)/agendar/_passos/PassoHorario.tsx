'use client'
import { useCallback, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { DayStrip, TimeGrid, groupTimes } from '@/ui/components'
import type { DiaLivre } from '../consultas'
import type { Sugestao } from '../fluxo'
import type { Consultas } from '../tipos'
import { useConsulta } from '../use-consulta'
import { ConsultaFalhou, ListaCarregando, Passo } from './Passo'

export type EscopoDeHorario = { serviceIds: string[]; petId: string; professionalId: string | null; rescheduling: string | null }

/** Quando? Faixa de dias (14 por vez, "Mais dias") e os horários livres do dia em chips; só o dia escolhido é consultado. */
export function PassoHorario(p: {
  consultas: Consultas
  today: string
  escopo: EscopoDeHorario
  date: string | null
  startsAt: string | null
  aviso: string | null
  sugestoes: Sugestao[]
  onDia: (date: string) => void
  onHorario: (iso: string, label: string) => void
}) {
  const chave = `${p.escopo.serviceIds.join(',')}|${p.escopo.petId}|${p.escopo.professionalId ?? ''}|${p.escopo.rescheduling ?? ''}`
  // Mudou o que a agenda depende (pet, serviços, profissional): recomeça a lista de dias do zero.
  return <Corpo key={chave} {...p} />
}

function Corpo({ consultas, today, escopo, date, startsAt, aviso, sugestoes, onDia, onHorario }: Parameters<typeof PassoHorario>[0]) {
  const chaveIds = escopo.serviceIds.join(',')
  const { petId, professionalId, rescheduling } = escopo
  const buscarDias = useCallback(
    () => consultas.dias({ from: today, serviceIds: chaveIds === '' ? [] : chaveIds.split(','), petId, professionalId, rescheduling }),
    [consultas, today, chaveIds, petId, professionalId, rescheduling],
  )
  const primeira = useConsulta(buscarDias)
  const [mais, setMais] = useState<{ dias: DiaLivre[]; hasMore: boolean | null; proximo: string | null; carregando: boolean; erro: string | null }>({ dias: [], hasMore: null, proximo: null, carregando: false, erro: null })

  const dias = primeira.pedido?.ok ? [...primeira.pedido.dias, ...mais.dias] : []
  const temMais = primeira.pedido?.ok ? (mais.hasMore ?? primeira.pedido.hasMore) : false
  const ativo = date ?? dias.find((d) => d.available)?.date ?? null

  const buscarHorarios = useCallback(
    () => consultas.horarios({ date: ativo ?? '', serviceIds: chaveIds === '' ? [] : chaveIds.split(','), petId, professionalId, rescheduling }),
    [consultas, ativo, chaveIds, petId, professionalId, rescheduling],
  )
  const horarios = useConsulta(ativo === null ? null : buscarHorarios)

  async function carregarMais() {
    const de = mais.proximo ?? (primeira.pedido?.ok ? primeira.pedido.proximo : null)
    if (de === null || mais.carregando) return
    setMais((m) => ({ ...m, carregando: true, erro: null }))
    const r = await consultas.dias({ from: de, serviceIds: chaveIds === '' ? [] : chaveIds.split(','), petId, professionalId, rescheduling })
    setMais((m) => (r.ok ? { dias: [...m.dias, ...r.dias], hasMore: r.hasMore, proximo: r.proximo, carregando: false, erro: null } : { ...m, carregando: false, erro: r.message }))
  }

  function escolher(iso: string, label: string) {
    if (ativo !== null && ativo !== date) onDia(ativo)
    onHorario(iso, label)
  }

  return (
    <Passo id="horario" title="Quando?">
      {aviso ? (
        <div role="alert" className="af-cl-flow__notice">
          <p className="af-cl-quiz__error">
            <CircleAlert size={16} aria-hidden="true" />
            <span>{aviso}</span>
          </p>
          {sugestoes.length > 0 ? (
            <>
              <p className="af-cl-flow__suggest">Que tal um destes?</p>
              <div className="af-cl-quiz__chips">
                {sugestoes.map((s) => (
                  <button key={s.iso} type="button" className="af-cl-chip" onClick={() => onHorario(s.iso, s.label)}>
                    {s.date !== '' && s.date !== ativo ? `${s.label} (${s.date.slice(8, 10)}/${s.date.slice(5, 7)})` : s.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {primeira.pedido === null ? (
        <ListaCarregando linhas={2} />
      ) : !primeira.pedido.ok ? (
        <ConsultaFalhou message={primeira.pedido.message} onTentar={primeira.tentar} />
      ) : !dias.some((d) => d.available) && !temMais ? (
        <p className="af-cl-flow__empty" role="status">
          Sem horários nos próximos dias. Fale com a loja.
        </p>
      ) : (
        <>
          <DayStrip days={dias} value={ativo} onChange={onDia} {...(temMais ? { onMore: carregarMais, moreLoading: mais.carregando } : {})} />
          {mais.erro ? (
            <p role="alert" className="af-cl-quiz__error">
              <CircleAlert size={16} aria-hidden="true" />
              <span>{mais.erro}</span>
            </p>
          ) : null}
          {ativo === null ? (
            <p className="af-cl-flow__empty" role="status">
              Toque em &ldquo;Mais dias&rdquo; para ver outros dias.
            </p>
          ) : horarios.pedido === null ? (
            <ListaCarregando linhas={1} />
          ) : !horarios.pedido.ok ? (
            <ConsultaFalhou message={horarios.pedido.message} onTentar={horarios.tentar} />
          ) : horarios.pedido.horarios.length === 0 ? (
            <p className="af-cl-flow__empty" role="status">
              Sem horários neste dia. Escolha outro.
            </p>
          ) : (
            <TimeGrid groups={groupTimes(horarios.pedido.horarios)} value={startsAt} onChange={(iso) => escolher(iso, horarios.pedido?.ok ? (horarios.pedido.horarios.find((h) => h.iso === iso)?.label ?? '') : '')} />
          )}
        </>
      )}
    </Passo>
  )
}
