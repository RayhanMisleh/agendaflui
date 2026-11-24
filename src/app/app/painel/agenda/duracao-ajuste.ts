/**
 * Duração que o formulário de ajustes propõe: enquanto o pet e os serviços são os do atendimento, vale a duração guardada nele
 * (a tabela de hoje não muda o que já foi marcado); depois de trocar pet ou serviço, vale a soma da tabela viva.
 */
export function duracaoBase(a: {
  petId: string | null
  marcados: string[]
  original: { petId: string | null; serviceIds: string[] }
  somaViva: number
  totalGuardado: number
}): number {
  const mexeu =
    a.petId !== a.original.petId ||
    a.marcados.length !== a.original.serviceIds.length ||
    a.marcados.some((id) => !a.original.serviceIds.includes(id))
  return mexeu ? a.somaViva : a.totalGuardado
}

/**
 * O campo de duração só se chama `durationMin` (e só vai ao servidor) quando a equipe a editou: a duração apenas sugerida pela
 * tela pode estar velha (serviços do pet ainda carregando), então o domínio a refaz ao trocar pet ou serviços.
 */
export function nomeCampoDuracao(editada: boolean): 'durationMin' | 'durationSugerida' {
  return editada ? 'durationMin' : 'durationSugerida'
}
