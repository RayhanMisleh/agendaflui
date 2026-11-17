'use client'
import { useId, useState } from 'react'
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { cx } from './cx'

const HEX = /^#[0-9a-fA-F]{6}$/
const MENSAGEM = 'Use uma cor no formato #RRGGBB, com 6 dígitos.'

/**
 * Cor da marca: campo de texto `#RRGGBB` e seletor de cor nativo andam juntos, com a amostra ao lado.
 * Aceita minúsculas e normaliza para maiúsculas ao sair do campo (o servidor guarda assim). O erro de formato aparece
 * depois de a pessoa sair do campo, para não reclamar enquanto ela ainda digita.
 */
export function ColorField({
  label,
  name,
  value,
  onChange,
  error,
  warning,
  className,
}: {
  label: string
  name?: string
  value: string
  onChange: (valor: string) => void
  /** Erro vindo do servidor; vale mesmo sem a pessoa ter saído do campo. */
  error?: string
  /** Aviso do motor de cores ("a cor foi escurecida..."): não impede de seguir. */
  warning?: string
  className?: string
}) {
  const uid = useId()
  const [tocado, setTocado] = useState(false)
  const valido = HEX.test(value)
  const mensagem = error ?? (!valido && tocado ? MENSAGEM : undefined)
  const erroId = mensagem ? `${uid}-erro` : undefined
  const avisoId = warning && valido ? `${uid}-aviso` : undefined

  return (
    <div className={cx('af-field af-colorfield', className)}>
      <label htmlFor={`${uid}-texto`} className="af-field__label">
        {label}
      </label>
      <div className="af-colorfield__row">
        <span className="af-colorfield__swatch" style={{ backgroundColor: valido ? value : 'transparent' }} data-empty={valido ? undefined : ''}>
          <input
            type="color"
            className="af-colorfield__picker"
            aria-label={`${label}: escolher no seletor`}
            value={valido ? value.toLowerCase() : '#000000'}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
          />
        </span>
        <input
          id={`${uid}-texto`}
          name={name}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={7}
          className="af-input af-colorfield__text"
          value={value}
          aria-invalid={mensagem ? true : undefined}
          aria-describedby={[erroId, avisoId].filter(Boolean).join(' ') || undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => {
            setTocado(true)
            if (valido && value !== value.toUpperCase()) onChange(value.toUpperCase())
          }}
        />
      </div>
      {mensagem ? (
        <p id={erroId} className="af-field__error">
          <CircleAlert size={16} aria-hidden="true" />
          <span>{mensagem}</span>
        </p>
      ) : null}
      {warning && valido ? (
        <p id={avisoId} className="af-colorfield__warning" role="status">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{warning}</span>
        </p>
      ) : null}
    </div>
  )
}
