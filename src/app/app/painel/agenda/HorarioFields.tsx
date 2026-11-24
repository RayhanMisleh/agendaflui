'use client'
import { useEffect, useState } from 'react'
import { horaDoRotulo, rotuloDoHorario } from '@/app/_lib/form-state'
import type { Conflito } from '@/app/_lib/form-state'
import { Button, Field, Input, TimeChip } from '@/ui/components'
import { buscarHorarios } from './consultas'
import type { HorarioLivre } from './consultas'

/**
 * Dia, horários livres do servidor e "outro horário" (a equipe pode marcar fora da grade; só conflito recusa). O horário
 * escolhido da lista viaja como o instante que o servidor deu (`startsAt`); o digitado, como dia e hora locais. Os campos
 * `date`, `time` e `startsAt` fazem parte do formulário de quem usa. Sem serviços escolhidos não há o que consultar.
 */
export function HorarioFields({
  serviceIds,
  professionalId,
  petId,
  durationMin,
  date,
  onDate,
  time,
  onTime,
  chosen,
  onChosen,
  prefillTime,
  conflict,
  errors,
  idPrefix,
}: {
  serviceIds: string[]
  professionalId: string
  petId?: string
  durationMin?: number
  date: string
  onDate: (d: string) => void
  time: string
  onTime: (t: string) => void
  chosen: string
  onChosen: (iso: string) => void
  prefillTime: string
  conflict: Conflito | undefined
  errors: { date?: string | undefined; time?: string | undefined }
  idPrefix: string
}) {
  const [horarios, setHorarios] = useState<HorarioLivre[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const chave = serviceIds.join(',')

  useEffect(() => {
    // Dia, profissional ou serviços mudaram: o instante escolhido na lista antiga não vale mais (outro dia, outra duração).
    if (chosen !== '') onChosen('')
    if (chave === '' || date === '') return
    let vivo = true
    void buscarHorarios({ serviceIds: chave.split(','), date, professionalId, ...(petId ? { petId } : {}), ...(durationMin !== undefined ? { durationMin } : {}) }).then((r) => {
      if (!vivo) return
      if (r.ok) {
        setHorarios(r.horarios)
        setErro(null)
        const ofertado = r.horarios.find((h) => horaDoRotulo(h.label) === prefillTime)
        if (ofertado && chosen === '') onChosen(ofertado.iso)
      } else {
        setHorarios([])
        setErro(r.message)
      }
    })
    return () => {
      vivo = false
    }
    // `chosen` fica de fora de propósito: a consulta só refaz quando muda o que a define (ele é lido na resposta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, date, professionalId, prefillTime, petId, durationMin])

  const lista = chave === '' ? null : horarios
  const foraDaLista = chosen === '' && time !== '' && lista !== null && !lista.some((h) => horaDoRotulo(h.label) === time)

  return (
    <>
      <Field label="Dia" error={errors.date}>
        <Input
          id={`${idPrefix}-dia`}
          type="date"
          name="date"
          value={date}
          onChange={(e) => {
            onDate(e.target.value)
            // Outro dia: a escolha da lista antiga não vale mais.
            onChosen('')
          }}
          required
        />
      </Field>
      <fieldset className="af-pick">
        <legend className="af-field__label">Horários livres</legend>
        {lista === null ? <p className="af-section__help">Escolha os serviços para ver os horários livres do dia.</p> : null}
        {erro ? (
          <p role="alert" className="af-rowerror">
            {erro}
          </p>
        ) : null}
        {lista && lista.length === 0 && !erro ? <p className="af-section__help">Nenhum horário livre neste dia. Escolha outro dia ou digite um horário abaixo.</p> : null}
        {lista && lista.length > 0 ? (
          <div className="af-pick__times">
            {lista.map((h) => (
              <TimeChip
                key={h.iso}
                time={h.label}
                state={chosen === h.iso ? 'selected' : 'free'}
                onSelect={() => {
                  onChosen(h.iso)
                  onTime(horaDoRotulo(h.label))
                }}
              />
            ))}
          </div>
        ) : null}
        <input type="hidden" name="startsAt" value={chosen} />
      </fieldset>
      <Field label="Outro horário" hint="Você pode usar qualquer horário. Se cair em cima de outro atendimento, fora do expediente ou num bloqueio, você confirma antes." error={errors.time}>
        <Input
          id={`${idPrefix}-hora`}
          type="time"
          name="time"
          step={300}
          value={time}
          onChange={(e) => {
            onTime(e.target.value)
            onChosen('')
          }}
        />
      </Field>
      {foraDaLista ? <p className="af-planner__warn">Este horário está fora dos livres da agenda. Se houver conflito, você confirma antes de salvar.</p> : null}
      {conflict && conflict.nearest.length > 0 ? (
        <div className="af-pick" role="group" aria-label="Horários livres mais próximos">
          <p className="af-section__help">Horários livres mais próximos:</p>
          <div className="af-pick__times">
            {conflict.nearest.map((n) => (
              <Button
                key={n.iso}
                size="sm"
                variant="secondary"
                onClick={() => {
                  // O horário sugerido leva o próprio dia: sem isso a ação vê o dia antigo e recusa. Trocar o dia refaz a
                  // consulta e solta a escolha da lista; o dia e a hora locais dão o mesmo horário.
                  if (n.date !== '' && n.date !== date) onDate(n.date)
                  onChosen(n.iso)
                  onTime(horaDoRotulo(n.label))
                }}
              >
                Usar {rotuloDoHorario(n, date)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
