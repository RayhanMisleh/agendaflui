import { useId } from 'react'
import { cx } from './cx'

const CX = 100
const CY = 104
const R = 78

function polar(frac: number, radius: number) {
  const a = Math.PI * (1 - frac)
  return { x: CX + radius * Math.cos(a), y: CY - radius * Math.sin(a) }
}

/** Medidor analógico. `value` de 0 a 1; `display` é o texto lido (por exemplo "98%"). */
export function Gauge({
  value,
  label,
  display,
  className,
}: {
  value: number
  label: string
  display: string
  className?: string
}) {
  const uid = useId().replace(/:/g, '')
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  const ticks = Array.from({ length: 21 }, (_, i) => i / 20)
  return (
    <figure className={cx('af-gauge', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={v}
        aria-valuetext={display}
        className="af-gauge__dial"
      >
        <svg viewBox="0 0 200 124" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${uid}-face`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#F4F0E4" />
              <stop offset="1" stopColor="#D9D4C4" />
            </linearGradient>
            <linearGradient id={`${uid}-glass`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity=".5" />
              <stop offset=".45" stopColor="#fff" stopOpacity=".08" />
              <stop offset=".46" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="198" height="122" rx="10" fill="#171B21" />
          <rect x="6" y="6" width="188" height="112" rx="6" fill={`url(#${uid}-face)`} />
          <rect x="6" y="6" width="188" height="112" rx="6" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="2" />
          {ticks.map((t, i) => {
            const major = i % 10 === 0
            const mid = i % 5 === 0
            const a = polar(t, R)
            const b = polar(t, R - (major ? 14 : mid ? 10 : 6))
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#1B1A17"
                strokeWidth={major ? 2.4 : mid ? 1.8 : 1}
                strokeLinecap="round"
              />
            )
          })}
          <text x={polar(0, R - 24).x + 2} y={CY - 6} fontSize="11" fill="#3b3935" textAnchor="start">
            0
          </text>
          <text x={polar(1, R - 24).x - 2} y={CY - 6} fontSize="11" fill="#3b3935" textAnchor="end">
            100
          </text>
          <g className="af-gauge__needle" style={{ transform: `rotate(${-90 + 180 * v}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
            <line x1={CX} y1={CY + 8} x2={CX} y2={CY - R + 6} stroke="#B3261E" strokeWidth="2.6" strokeLinecap="round" />
          </g>
          <circle cx={CX} cy={CY} r="8" fill="#2A2F37" />
          <circle cx={CX} cy={CY} r="3" fill="#8E96A3" />
          <rect x="6" y="6" width="188" height="112" rx="6" fill={`url(#${uid}-glass)`} />
        </svg>
      </div>
      <figcaption className="af-gauge__caption">
        <span className="af-gauge__display">{display}</span>
        <span className="af-gauge__label af-engraved">{label}</span>
      </figcaption>
    </figure>
  )
}
