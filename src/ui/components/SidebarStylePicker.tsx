'use client'
import { useId } from 'react'
import { previewTheme } from '@/shared/theme/preview'
import type { CoverMaterial } from '@/shared/theme/derive'
import { SIDEBAR_FIELD_LABEL, SIDEBAR_OPTIONS } from '@/shared/theme/labels'
import { themeAttrs } from '../theme/ThemeScope'
import { cx } from './cx'

/**
 * Escolha da barra lateral: quatro miniaturas (Cheia, Suave, Noite e Clara) já na cor da conta, para a pessoa ver cada uma
 * antes de decidir. São botões de rádio nativos (funcionam sem JavaScript), com o rótulo e a descrição de `labels`.
 */
export function SidebarStylePicker({
  name,
  value,
  onChange,
  primary,
  accent,
  className,
}: {
  name?: string
  value: CoverMaterial
  onChange: (m: CoverMaterial) => void
  primary: string
  accent: string
  className?: string
}) {
  const uid = useId()
  return (
    <div role="radiogroup" aria-labelledby={`${uid}-legenda`} className={cx('af-sidepick', className)}>
      <span id={`${uid}-legenda`} className="af-field__label">
        {SIDEBAR_FIELD_LABEL}
      </span>
      <div className="af-sidepick__grid">
        {SIDEBAR_OPTIONS.map((m) => {
          // Cada miniatura usa as variáveis da conta com o estilo de barra dela.
          const { theme } = previewTheme({ primary, accent, material: m.value })
          return (
            <div key={m.value} className="af-sidepick__opt">
              <input
                id={`${uid}-${m.value}`}
                type="radio"
                name={name}
                value={m.value}
                checked={value === m.value}
                onChange={() => onChange(m.value)}
                aria-describedby={`${uid}-${m.value}-dica`}
                className="af-sidepick__input"
              />
              <label htmlFor={`${uid}-${m.value}`} className="af-sidepick__face">
                <span className="af-sidepick__thumb" aria-hidden="true" {...themeAttrs(theme)}>
                  <span className="af-sidepick__side">
                    <span className="af-sidepick__logo" />
                    <span className="af-sidepick__item af-sidepick__item--active" />
                    <span className="af-sidepick__item" />
                    <span className="af-sidepick__item" />
                  </span>
                  <span className="af-sidepick__page">
                    <span className="af-sidepick__bar" />
                    <span className="af-sidepick__card" />
                    <span className="af-sidepick__card af-sidepick__card--short" />
                  </span>
                </span>
                <span className="af-sidepick__label">{m.label}</span>
              </label>
              <span id={`${uid}-${m.value}-dica`} className="af-sidepick__hint">
                {m.hint}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
