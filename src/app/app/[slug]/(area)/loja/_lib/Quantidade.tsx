'use client'
import { Minus, Plus } from 'lucide-react'

/** − / número / +, em botões de 44 px. Controlada: quem usa guarda o valor (a página do produto). */
export function Quantidade({ value, min = 1, max, onChange, label = 'Quantidade' }: { value: number; min?: number; max: number; onChange: (n: number) => void; label?: string }) {
  return (
    <div className="af-cl-qty" role="group" aria-label={label}>
      <button type="button" className="af-cl-qty__btn" aria-label="Diminuir" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={18} aria-hidden="true" />
      </button>
      <output className="af-cl-qty__value" aria-live="polite">
        {value}
      </output>
      <button type="button" className="af-cl-qty__btn" aria-label="Aumentar" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  )
}
