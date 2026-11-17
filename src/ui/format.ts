const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/** Inteiro em pt-BR, com ponto de milhar (`1.234.567`). O único formatador de inteiros das telas. */
export function formatInt(n: number): string {
  return INT.format(n)
}
