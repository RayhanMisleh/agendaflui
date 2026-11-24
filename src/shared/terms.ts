/** "1 ponto", "2 pontos", "0 pontos": os termos do sistema são fixos (Pontos, Clube, Profissionais, Clientes). */
export function pointsText(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'ponto' : 'pontos'}`
}

/** Os termos do sistema, iguais para todas as contas (a personalização por conta saiu). */
export const TERMS = {
  professionalSingular: 'Profissional',
  professionalPlural: 'Profissionais',
  customerSingular: 'Cliente',
  customerPlural: 'Clientes',
  pointsSingular: 'Ponto',
  pointsPlural: 'Pontos',
  club: 'Clube',
} as const
