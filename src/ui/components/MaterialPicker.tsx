'use client'
import { useId } from 'react'
import { previewTheme } from '@/shared/theme/preview'
import type { CoverMaterial, FontPair, PaperTone } from '@/shared/theme/derive'
import { cx } from './cx'

const MATERIAIS: ReadonlyArray<{ value: CoverMaterial; label: string; hint: string }> = [
  { value: 'LEATHER', label: 'Couro', hint: 'Grão de poros, clássico' },
  { value: 'LINEN', label: 'Linho', hint: 'Trama de fios, macio' },
  { value: 'WOOD', label: 'Madeira', hint: 'Veios e tábuas' },
  { value: 'ENAMEL', label: 'Esmalte', hint: 'Laca lisa e brilhante' },
]

/**
 * Escolha do material da capa: quatro amostras já na cor principal escolhida, para a pessoa ver o couro, o linho, a
 * madeira e o esmalte nessa cor antes de decidir. São botões de rádio nativos (funcionam sem JavaScript).
 */
export function MaterialPicker({
  name,
  value,
  onChange,
  primary,
  accent,
  paper,
  fontPair,
  className,
}: {
  name?: string
  value: CoverMaterial
  onChange: (m: CoverMaterial) => void
  primary: string
  accent: string
  paper: PaperTone
  fontPair: FontPair
  className?: string
}) {
  const uid = useId()
  // As amostras usam as variáveis da cor escolhida; o material de cada uma vem do próprio `data-material`.
  const { tokens } = previewTheme({ primary, accent, material: value, paper, fontPair })
  return (
    <div role="radiogroup" aria-labelledby={`${uid}-legenda`} className={cx('af-matpick', className)} style={tokens}>
      <span id={`${uid}-legenda`} className="af-field__label">
        Material da capa
      </span>
      <div className="af-matpick__grid">
        {MATERIAIS.map((m) => (
          <div key={m.value} className="af-matpick__opt">
            <input
              id={`${uid}-${m.value}`}
              type="radio"
              name={name}
              value={m.value}
              checked={value === m.value}
              onChange={() => onChange(m.value)}
              aria-describedby={`${uid}-${m.value}-dica`}
              className="af-matpick__input"
            />
            <label htmlFor={`${uid}-${m.value}`} className="af-matpick__face">
              <span className="af-cover af-matpick__swatch" data-material={m.value.toLowerCase()} aria-hidden="true" />
              <span className="af-matpick__label">{m.label}</span>
            </label>
            <span id={`${uid}-${m.value}-dica`} className="af-matpick__hint">
              {m.hint}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
