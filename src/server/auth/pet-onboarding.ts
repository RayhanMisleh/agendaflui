import 'server-only'
import type { CustomerVisit } from './customer-access'

/**
 * Costura com a fase 2 (pets): "a loja é de pet shop e esta pessoa ainda não tem pet ativo?" decide se o primeiro destino
 * depois de entrar é o quiz. Sem o cadastro de pets nesta base, nenhuma loja pede o quiz. A integração troca o corpo por
 * `getNicheSettings` (nicho pet) e `listMyPets` (nenhum pet ativo).
 */
export async function needsPetQuiz(visit: CustomerVisit): Promise<boolean> {
  void visit
  return false
}
