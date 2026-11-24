/**
 * Regra 9 do Google: trocar o e-mail da pessoa para um diferente do e-mail do Google vinculado desvincula o Google.
 * Pura (a tela avisa antes de confirmar e o domínio decide com a mesma conta).
 */
export function emailChangeUnlinksGoogle(google: { email: string } | null, newEmail: string): boolean {
  if (google === null) return false
  return newEmail.trim().toLowerCase() !== google.email.trim().toLowerCase()
}
