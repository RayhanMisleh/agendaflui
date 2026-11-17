/**
 * Lê um valor em reais digitado por gente: "35,90", "35.90", "1.234,56", "R$ 35", "35". Devolve centavos inteiros, ou
 * `null` quando não é dinheiro (texto, negativo, mais de duas casas, vários separadores sem sentido).
 */
export function parseMoney(texto: string): number | null {
  const t = texto.replace(/^\s*R\$\s*/i, '').replace(/\s+/g, '')
  if (t === '' || !/^[\d.,]+$/.test(t)) return null
  const virgula = t.lastIndexOf(',')
  const ponto = t.lastIndexOf('.')
  let inteiro: string
  let fracao = ''
  if (virgula >= 0 && ponto >= 0) {
    const decimal = Math.max(virgula, ponto)
    const milhar = decimal === virgula ? '.' : ','
    inteiro = t.slice(0, decimal)
    fracao = t.slice(decimal + 1)
    if (inteiro.split(milhar).some((g, i) => (i === 0 ? g.length < 1 || g.length > 3 : g.length !== 3)) || /[.,]/.test(inteiro.split(milhar).join(''))) return null
    inteiro = inteiro.split(milhar).join('')
  } else if (virgula >= 0 || ponto >= 0) {
    const sep = virgula >= 0 ? ',' : '.'
    const partes = t.split(sep)
    const ultimo = partes[partes.length - 1] ?? ''
    if (partes.length > 2 || (partes.length === 2 && ultimo.length === 3 && sep === '.')) {
      // Só milhar: "1.234" ou "1.234.567".
      if (sep === ',' || partes.slice(1).some((g) => g.length !== 3) || (partes[0] ?? '').length > 3 || (partes[0] ?? '') === '') return null
      inteiro = partes.join('')
    } else {
      inteiro = partes[0] ?? ''
      fracao = ultimo
    }
  } else {
    inteiro = t
  }
  if (inteiro === '' && fracao === '') return null
  if (!/^\d*$/.test(inteiro) || !/^\d{0,2}$/.test(fracao)) return null
  const reais = inteiro === '' ? 0 : Number(inteiro)
  if (!Number.isSafeInteger(reais)) return null
  return reais * 100 + Number(fracao.padEnd(2, '0') || '0')
}

/** Centavos como o campo mostra: `3590` → `35,90`. */
export function formatMoneyInput(cents: number): string {
  const reais = Math.trunc(cents / 100)
  const resto = String(Math.abs(cents % 100)).padStart(2, '0')
  return `${reais},${resto}`
}

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
