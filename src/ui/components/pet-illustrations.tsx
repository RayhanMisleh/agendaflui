import type { PriceVariant } from '@/server/db/generated/client'

/** Escala do desenho de cada cão: o porte maior ocupa mais do quadro, sempre apoiado na mesma linha de base. */
const ESCALA: Record<Exclude<PriceVariant, 'CAT'>, number> = { DOG_SMALL: 0.62, DOG_MEDIUM: 0.78, DOG_LARGE: 0.92, DOG_GIANT: 1.06 }

/**
 * Desenho em traço do pet de cada variante de preço: quatro cães de tamanhos crescentes e um gato. O traço usa
 * `currentColor` (1,75, cantos redondos, no estilo dos ícones) e o desenho é só enfeite (`aria-hidden`).
 */
export function PetIllustration({ variant, size = 48 }: { variant: PriceVariant; size?: number }) {
  const escala = variant === 'CAT' ? 0.92 : ESCALA[variant]
  const traco = 1.75 / escala
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={traco}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-variant={variant}
    >
      <g transform={`translate(12 22) scale(${escala}) translate(-12 -22)`}>{variant === 'CAT' ? <Gato /> : <Cao />}</g>
    </svg>
  )
}

function Cao() {
  return (
    <>
      <path d="M7.5 9.5C7.5 6.9 9.4 5.5 12 5.5s4.5 1.4 4.5 4v4.2c0 3.2-2 5.8-4.5 5.8s-4.5-2.6-4.5-5.8z" />
      <path d="M7.6 8.4C5.5 8 4 9.6 4 12.6c0 1.9 1 3.1 2.4 3" />
      <path d="M16.4 8.4C18.5 8 20 9.6 20 12.6c0 1.9-1 3.1-2.4 3" />
      <path d="M10.7 14.6h2.6l-1.3 1.5z" fill="currentColor" />
      <path d="M12 16.1v1.2" />
      <circle cx="9.8" cy="11.2" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="11.2" r="0.55" fill="currentColor" stroke="none" />
    </>
  )
}

function Gato() {
  return (
    <>
      <path d="M5.2 10.2 4.6 4.2 8.6 6.8a8.2 8.2 0 0 1 6.8 0l4-2.6-.6 6c.8 1.1 1.1 2.3 1.1 3.5 0 4.2-3.5 6.6-8.5 6.6S3.5 17.9 3.5 13.7c0-1.2.3-2.4 1.7-3.5z" />
      <path d="M10.8 14h2.4l-1.2 1.4z" fill="currentColor" />
      <path d="M12 15.4v1" />
      <path d="M2.6 13.6 7 14.3M2.8 16.4 7 15.5M21.4 13.6 17 14.3M21.2 16.4 17 15.5" />
      <circle cx="9" cy="11.6" r="0.55" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11.6" r="0.55" fill="currentColor" stroke="none" />
    </>
  )
}
