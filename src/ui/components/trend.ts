export type TrendDirection = 'up' | 'down' | 'same'

/** A tendência pronta para mostrar: direção (para a seta), frase e, quando há, o total do mês anterior como referência. */
export type TrendInfo = { direction: TrendDirection; text: string; reference?: string }

const INT = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

/**
 * Compara o mês até hoje com o MESMO trecho do mês passado (comparação honesta de mês parcial com mês parcial) e diz o
 * resultado em palavras: "12 a mais que no mesmo período do mês passado". O total do mês passado inteiro vai de referência.
 * `fmt` formata os números (inteiros por padrão; passe `formatBrl` para dinheiro).
 */
export function describeTrend(
  t: { current: number; previousSamePeriod: number; previous: number },
  fmt: (n: number) => string = (n) => INT.format(n),
): TrendInfo {
  const diff = t.current - t.previousSamePeriod
  const reference = `Mês passado inteiro: ${fmt(t.previous)}`
  if (diff === 0) return { direction: 'same', text: 'igual ao mesmo período do mês passado', reference }
  if (diff > 0) return { direction: 'up', text: `${fmt(diff)} a mais que no mesmo período do mês passado`, reference }
  return { direction: 'down', text: `${fmt(-diff)} a menos que no mesmo período do mês passado`, reference }
}
