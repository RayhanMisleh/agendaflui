import type { ReactNode } from 'react'

/*
 * Ilustrações em traço da área do cliente, no estilo dos ícones Lucide: `currentColor`, 1,75 de espessura, pontas
 * redondas, 64 × 64. Decorativas (`aria-hidden`): quem usa diz o que mostram em texto.
 */
function Traco({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** Cão ou gato, de frente. */
export function SpeciesIllustration({ species, size = 64 }: { species: 'DOG' | 'CAT'; size?: number }) {
  if (species === 'CAT') {
    return (
      <Traco size={size}>
        <path d="M17 27 19 10l10 7M47 27 45 10l-10 7" />
        <path d="M17 28c0-6 6-11 15-11s15 5 15 11v6c0 9-7 15-15 15s-15-6-15-15z" />
        <circle cx="26" cy="31" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="38" cy="31" r="1.4" fill="currentColor" stroke="none" />
        <path d="M30 37h4l-2 2.4z" fill="currentColor" />
        <path d="M32 39.4v2.2M28.5 43c1.1 1 2.3 1.4 3.5 1.4s2.4-.4 3.5-1.4" />
        <path d="M9 34l9 1.5M9 40l9-1.5M55 34l-9 1.5M55 40l-9-1.5" />
      </Traco>
    )
  }
  return (
    <Traco size={size}>
      <path d="M20 26c0-8 5-13 12-13s12 5 12 13v8c0 9-5 15-12 15s-12-6-12-15z" />
      <path d="M20 24c-6 0-9 5-9 12 0 4 2 6 5 6 2 0 4-2 4-6M44 24c6 0 9 5 9 12 0 4-2 6-5 6-2 0-4-2-4-6" />
      <circle cx="27" cy="31" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="37" cy="31" r="1.4" fill="currentColor" stroke="none" />
      <ellipse cx="32" cy="38" rx="3.2" ry="2.3" fill="currentColor" stroke="none" />
      <path d="M32 40.5v3M28.5 44.5c1.2 1.4 2.4 1.9 3.5 1.9s2.3-.5 3.5-1.9" />
    </Traco>
  )
}

export type EmptyIllustrationName = 'horarios' | 'pets' | 'premios' | 'carrinho' | 'pedidos' | 'loja-fechada'

/** Desenhos dos estados vazios: horários, pets, prêmios, carrinho, pedidos e loja fechada. */
export function EmptyIllustration({ name, size = 96 }: { name: EmptyIllustrationName; size?: number }) {
  switch (name) {
    case 'horarios':
      return (
        <Traco size={size}>
          <rect x="10" y="14" width="44" height="40" rx="9" />
          <path d="M22 9v10M42 9v10M10 28h44" />
          <path d="M25 41l5 5 9-10" />
        </Traco>
      )
    case 'pets':
      return (
        <Traco size={size}>
          <path d="M32 33c-7 0-12 5-12 10 0 4 3 6 6 6 2 0 3.5-1.2 6-1.2S36 49 38 49c3 0 6-2 6-6 0-5-5-10-12-10z" />
          <ellipse cx="17" cy="29" rx="4" ry="5" transform="rotate(-18 17 29)" />
          <ellipse cx="27" cy="19" rx="4" ry="5.5" />
          <ellipse cx="37" cy="19" rx="4" ry="5.5" />
          <ellipse cx="47" cy="29" rx="4" ry="5" transform="rotate(18 47 29)" />
        </Traco>
      )
    case 'premios':
      return (
        <Traco size={size}>
          <rect x="11" y="26" width="42" height="27" rx="4" />
          <rect x="9" y="18" width="46" height="9" rx="3" />
          <path d="M32 18v35" />
          <path d="M32 18c-3-8-13-9-13-4 0 4 8 4 13 4zm0 0c3-8 13-9 13-4 0 4-8 4-13 4z" />
        </Traco>
      )
    case 'carrinho':
      return (
        <Traco size={size}>
          <path d="M9 13h8l6 26h26l5-19H19" />
          <circle cx="26" cy="48" r="3.5" />
          <circle cx="45" cy="48" r="3.5" />
        </Traco>
      )
    case 'pedidos':
      return (
        <Traco size={size}>
          <path d="M32 9l21 10.5v25L32 55 11 44.5v-25z" />
          <path d="M11 19.5 32 30l21-10.5M32 30v25M21.5 14.3 42.5 24.7" />
        </Traco>
      )
    case 'loja-fechada':
      return (
        <Traco size={size}>
          <path d="M9 25l4-13h38l4 13" />
          <path d="M9 25c0 4 3.5 6 7 6s7-2 7-6c0 4 3.5 6 9 6s9-2 9-6c0 4 3.5 6 7 6s7-2 7-6" />
          <path d="M13 31v22h38V31" />
          <path d="M27 53V41h10v12" />
          <path d="M22 9h20" />
        </Traco>
      )
  }
}
