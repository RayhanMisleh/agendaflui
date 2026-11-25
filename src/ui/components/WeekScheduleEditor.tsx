'use client'
import { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { weekdayName } from '@/ui/format'
import { WEEK_ORDER } from '@/ui/week'
import type { Range, Weekday, WeekValue } from '@/ui/week'
import { Button } from './Button'

const NOVA_FAIXA: Range = { start: '09:00', end: '18:00' }
const minusculo = (d: Weekday): string => weekdayName(d).toLowerCase()

/**
 * Editor do expediente da semana: um grupo por dia, com faixas de início e fim em `HH:mm` (de 5 em 5 minutos). Cada
 * faixa vira dois campos do formulário (`MONDAY.0.start`, `MONDAY.0.end`), então funciona num `<form>` comum. Dia sem
 * faixa é "Fechado". "Copiar" leva as faixas de um dia para todos os outros. `errors` traz o erro de cada faixa
 * (`MONDAY.1.end`) ou do dia inteiro (`MONDAY`, faixas que se sobrepõem).
 */
export function WeekScheduleEditor({
  defaultValue = {},
  errors = {},
}: {
  defaultValue?: WeekValue
  errors?: Record<string, string>
}) {
  const [week, setWeek] = useState<Record<Weekday, Range[]>>(() => {
    const inicial = {} as Record<Weekday, Range[]>
    for (const d of WEEK_ORDER) inicial[d] = (defaultValue[d] ?? []).map((r) => ({ ...r }))
    return inicial
  })
  const trocar = (dia: Weekday, faixas: Range[]) => setWeek((w) => ({ ...w, [dia]: faixas }))
  const editar = (dia: Weekday, i: number, lado: keyof Range, valor: string) =>
    trocar(dia, week[dia].map((r, j) => (j === i ? { ...r, [lado]: valor } : r)))
  const copiar = (dia: Weekday) =>
    setWeek((w) => {
      const origem = w[dia]
      const novo = {} as Record<Weekday, Range[]>
      for (const d of WEEK_ORDER) novo[d] = d === dia ? origem : origem.map((r) => ({ ...r }))
      return novo
    })

  return (
    <div className="af-hours">
      {WEEK_ORDER.map((dia) => {
        const faixas = week[dia]
        const nome = weekdayName(dia)
        return (
          <fieldset key={dia} className="af-hours__day" aria-label={nome}>
            <legend className="af-hours__name">{nome}</legend>
            {faixas.length === 0 ? <p className="af-hours__closed">Fechado</p> : null}
            {faixas.map((r, i) => {
              const erroInicio = errors[`${dia}.${i}.start`]
              const erroFim = errors[`${dia}.${i}.end`]
              return (
                <div key={i} className="af-hours__range">
                  <input
                    className="af-input af-hours__time"
                    type="time"
                    step={300}
                    name={`${dia}.${i}.start`}
                    value={r.start}
                    onChange={(e) => editar(dia, i, 'start', e.target.value)}
                    aria-label={`Início da faixa ${i + 1}`}
                    aria-invalid={erroInicio ? true : undefined}
                  />
                  <span aria-hidden="true">às</span>
                  <input
                    className="af-input af-hours__time"
                    type="time"
                    step={300}
                    name={`${dia}.${i}.end`}
                    value={r.end}
                    onChange={(e) => editar(dia, i, 'end', e.target.value)}
                    aria-label={`Fim da faixa ${i + 1}`}
                    aria-invalid={erroFim ? true : undefined}
                  />
                  <Button size="sm" variant="ghost" icon={<Trash2 size={16} />} aria-label={`Remover faixa ${i + 1} de ${minusculo(dia)}`} onClick={() => trocar(dia, faixas.filter((_, j) => j !== i))} />
                  {erroInicio || erroFim ? <p className="af-field__error af-hours__error">{erroInicio ?? erroFim}</p> : null}
                </div>
              )
            })}
            {errors[dia] ? <p className="af-field__error af-hours__error">{errors[dia]}</p> : null}
            <div className="af-hours__tools">
              <Button size="sm" variant="secondary" icon={<Plus size={16} />} aria-label={`Adicionar faixa na ${minusculo(dia)}`} onClick={() => trocar(dia, [...faixas, { ...(faixas.length > 0 ? { start: faixas[faixas.length - 1]?.end ?? NOVA_FAIXA.start, end: NOVA_FAIXA.end } : NOVA_FAIXA) }])}>
                Adicionar faixa
              </Button>
              {faixas.length > 0 ? (
                <Button size="sm" variant="ghost" icon={<Copy size={16} />} aria-label={`Copiar ${minusculo(dia)} para os outros dias`} onClick={() => copiar(dia)}>
                  Copiar para os outros dias
                </Button>
              ) : null}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
