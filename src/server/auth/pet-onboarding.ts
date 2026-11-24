import 'server-only'
import { listMyPets } from '@/server/domain/pets/pets'
import { getNicheSettings } from '@/server/domain/settings/niche-settings'
import type { CustomerVisit } from './customer-access'

/**
 * "A loja é de pet shop e esta pessoa ainda não tem pet ativo?" Decide se o primeiro destino depois de entrar, cadastrar ou
 * usar a conta na loja é o quiz (`/<slug>/boas-vindas`). Loja de outro ramo nunca pede o quiz.
 */
export async function needsPetQuiz(visit: CustomerVisit): Promise<boolean> {
  const nicho = await getNicheSettings(visit.ctx)
  if (nicho.niche === null) return false
  return (await listMyPets(visit.ctx)).length === 0
}
