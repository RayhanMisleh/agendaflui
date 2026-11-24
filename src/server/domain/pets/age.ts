/**
 * Idade aproximada pelo mês de nascimento. `birthMonth` é 'AAAA-MM' (ou 'AAAA-MM-DD') e `today` a data local da conta.
 * Mês futuro devolve `null`.
 */
export function petAgeLabel(birthMonth: string, today: string): string | null {
  const meses = (texto: string): number => Number(texto.slice(0, 4)) * 12 + Number(texto.slice(5, 7)) - 1
  const total = meses(today) - meses(birthMonth)
  if (!Number.isFinite(total) || total < 0) return null
  if (total === 0) return 'Menos de 1 mês'
  if (total < 12) return total === 1 ? '1 mês' : `${total} meses`
  const anos = Math.floor(total / 12)
  return anos === 1 ? '1 ano' : `${anos} anos`
}
