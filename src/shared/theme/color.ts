// Conversões de cor e contraste. Funções puras, sem dependências.
// Cores sempre em hex '#RRGGBB' maiúsculo; OKLCH com L em escala 0–100.

export type Oklch = { l: number; c: number; h: number }
type Rgb = [number, number, number]

export function normalizeHex(input: string): string {
  const raw = input.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) {
    throw new RangeError('Use uma cor no formato #RRGGBB.')
  }
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : raw
  return `#${full.toUpperCase()}`
}

function hexToRgb(hex: string): Rgb {
  const h = normalizeHex(hex).slice(1)
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function rgbToHex([r, g, b]: Rgb): string {
  const part = (v: number) =>
    Math.min(255, Math.max(0, Math.round(v)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase()
}

const toLinear = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v: number) =>
  255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as Rgb
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(A, B)
  const h = c < 1e-7 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360
  return { l: L * 100, c, h }
}

function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const hr = (h * Math.PI) / 180
  const L = l / 100
  const A = c * Math.cos(hr)
  const B = c * Math.sin(hr)
  const lp = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const mp = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const sp = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
    -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
    -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
  ]
}

const EPS = 1e-6
const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -EPS && v <= 1 + EPS)

/** OKLCH → hex. Cor fora do gamut perde croma até caber (não corta canais). */
export function oklchToHex(color: Oklch): string {
  const l = Math.min(100, Math.max(0, color.l))
  let lin = oklchToLinear({ ...color, l })
  if (!inGamut(lin)) {
    let lo = 0
    let hi = color.c
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid
      else hi = mid
    }
    lin = oklchToLinear({ l, c: lo, h: color.h })
  }
  return rgbToHex(lin.map((v) => fromLinear(Math.min(1, Math.max(0, v)))) as Rgb)
}

/** Mesma matiz e croma, luminosidade deslocada em pontos (escala 0–100). */
export function shiftLightness(hex: string, delta: number): string {
  const c = hexToOklch(hex)
  return oklchToHex({ ...c, l: c.l + delta })
}

/** Mistura `from` em direção a `to` (t de 0 a 1), em sRGB. */
export function mix(from: string, to: string, t: number): string {
  const a = hexToRgb(from)
  const b = hexToRgb(to)
  return rgbToHex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * t) as Rgb)
}
