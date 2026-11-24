'use client'
import { useState } from 'react'
import { Checkbox, DurationField, Field, MoneyField, PetIllustration } from '@/ui/components'
import { formatMoneyInput } from '@/ui/money'
import type { PriceVariant } from '@/server/db/generated/client'
import { NICHES, visibleVariants } from '@/server/niches'

export type LinhaPreco = { variant: PriceVariant; priceCents: number; durationMin: number }

/** Nomes dos campos de uma linha de porte (a ação de servidor lê os mesmos). */
export const campoDaLinha = (v: PriceVariant) => ({ on: `v_${v}_on`, price: `v_${v}_price`, duration: `v_${v}_duration` })

type Valores = Record<string, string>

function Linha({
  variant,
  rotulo,
  step,
  linha,
  valores,
  erros,
  padrao,
}: {
  variant: PriceVariant
  rotulo: string
  step: number
  linha: LinhaPreco | undefined
  valores: Valores
  erros: Valores
  /** Marcação inicial quando a pessoa ainda não digitou nada (serviço novo: todas as linhas). */
  padrao: boolean
}) {
  const nomes = campoDaLinha(variant)
  const marcada = valores[nomes.on]
  const [ligada, setLigada] = useState(marcada !== undefined ? marcada === 'on' : linha ? true : padrao)
  const duracao = Number(valores[nomes.duration]) || linha?.durationMin
  return (
    <li className={`af-varrow${ligada ? '' : ' af-varrow--off'}`}>
      <span className="af-varrow__art" aria-hidden="true">
        <PetIllustration variant={variant} size={36} />
      </span>
      <span className="af-varrow__name">{rotulo}</span>
      <Checkbox
        name={nomes.on}
        className="af-varrow__on"
        label={
          <>
            <span className="af-sr">{rotulo}: </span>Atende
          </>
        }
        checked={ligada}
        onChange={(e) => setLigada(e.target.checked)}
      />
      <Field label="Preço (R$)" error={erros[nomes.price]} className="af-varrow__price">
        <MoneyField name={nomes.price} defaultValue={valores[nomes.price] ?? (linha ? formatMoneyInput(linha.priceCents) : '')} disabled={!ligada} />
      </Field>
      <Field label="Duração" error={erros[nomes.duration]} className="af-varrow__duration">
        <DurationField name={nomes.duration} stepMin={step} {...(duracao !== undefined ? { value: duracao } : {})} disabled={!ligada} />
      </Field>
    </li>
  )
}

/**
 * A tabela de preço e tempo por animal e porte: uma linha por variante visível (gato só com a loja atendendo gatos).
 * Linha desmarcada fica esmaecida e sem campos; a linha de gato que já estava gravada com gatos desligados fica guardada.
 */
export function ServicoPrecos({
  servesCats,
  step,
  prices,
  valores,
  erros,
  novo,
}: {
  servesCats: boolean
  step: number
  prices: readonly LinhaPreco[]
  valores: Valores
  erros: Valores
  novo: boolean
}) {
  const variantes = visibleVariants(NICHES.PET, { servesCats })
  const gatoGuardado = !servesCats && prices.some((p) => p.variant === 'CAT')
  return (
    <div id="servico-precos" className="af-varrows">
      <ul className="af-varrows__list" aria-label="Preço e duração por animal e porte">
        {variantes.map((d) => (
          <Linha
            key={d.key}
            variant={d.key}
            rotulo={d.rangeLabel ? `${d.shortLabel} · ${d.rangeLabel}` : d.shortLabel}
            step={step}
            linha={prices.find((p) => p.variant === d.key)}
            valores={valores}
            erros={erros}
            padrao={novo && d.species === 'DOG'}
          />
        ))}
      </ul>
      {gatoGuardado ? <p className="af-field__hint">A linha de gato fica guardada enquanto a loja não atende gatos.</p> : null}
    </div>
  )
}
