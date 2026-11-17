/** Porcentagem digitada ("30", "12,5", "12.50%") em pontos-base (3000, 1250); `null` se não for de 0 a 100 com até duas casas. */
export function parsePercentBps(texto: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(texto.replace(/\s+/g, '').replace(/%$/, ''))
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0')
  return bps > 10_000 ? null : bps
}

/** Pontos-base como o campo mostra: `1250` → `12,5`, `3000` → `30`. */
export function formatPercentInput(bps: number): string {
  const inteiro = Math.trunc(bps / 100)
  const resto = bps % 100
  return resto === 0 ? String(inteiro) : `${inteiro},${String(resto).padStart(2, '0').replace(/0$/, '')}`
}
