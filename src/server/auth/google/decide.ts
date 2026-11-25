import type { PersonState } from '@/server/auth/person'
import type { StoreRef } from '@/server/auth/store-join'
import type { GoogleIntent } from './flow'
import type { GoogleIdentity } from './id-token'

/*
 * As regras do Google (`docs/PRODUTO.md`, "Regras do Google"), numa função PURA: recebe a intenção do fluxo e os
 * fatos já lidos do banco e devolve a decisão. Nada de banco, relógio ou rede aqui. `callback.ts` lê os fatos sob a trava
 * da pessoa, chama esta função e só então escreve; por isso a decisão vale para o estado que será gravado.
 */

export type PersonFact = { id: string; email: string; state: PersonState; googleSub: string | null }

export type GoogleFacts = {
  identity: GoogleIdentity
  /** A pessoa dona deste Google (`sub`), se houver. */
  bySub: PersonFact | null
  /** A pessoa dona do e-mail do Google, se houver. */
  byEmail: PersonFact | null
  /** O convite do fluxo (token ainda válido): a pessoa convidada e o e-mail do convite. */
  invite: { userId: string; email: string } | null
  /** A loja do cadastro (aberta ao público). */
  store: StoreRef | null
  /** A pessoa da sessão atual (para vincular). */
  current: PersonFact | null
  /** A pessoa da sessão é da equipe de alguma loja (vínculo ativo): só ela liga a agenda. */
  currentIsStaff: boolean
}

export type GoogleRefusal =
  | 'email_not_verified'
  | 'account_exists'
  | 'unknown_google'
  | 'google_taken'
  | 'email_mismatch'
  | 'invite_invalid'
  | 'store_unavailable'
  | 'already_linked'
  | 'not_signed_in'
  | 'calendar_needs_google'
  | 'calendar_wrong_google'
  | 'calendar_staff_only'

export type GoogleDecision =
  | { kind: 'sign_in'; userId: string }
  | { kind: 'activate'; userId: string }
  | { kind: 'create' }
  | { kind: 'link'; userId: string }
  | { kind: 'calendar'; userId: string }
  | { kind: 'refuse'; reason: GoogleRefusal }

const recusa = (reason: GoogleRefusal): GoogleDecision => ({ kind: 'refuse', reason })

/** Entrar pelo Google com o e-mail de uma pessoa que ainda não o vinculou: conta ativa recusa (2); pendente ativa (2b). */
function porEmail(byEmail: PersonFact | null): GoogleDecision | null {
  if (byEmail === null) return null
  return byEmail.state === 'active' ? recusa('account_exists') : { kind: 'activate', userId: byEmail.id }
}

export function decideGoogle(intent: GoogleIntent, f: GoogleFacts): GoogleDecision {
  // Regra 10: sem e-mail verificado pelo Google, nada vale, nem para quem já tem o Google vinculado.
  if (!f.identity.emailVerified) return recusa('email_not_verified')
  const email = f.identity.email.toLowerCase()
  switch (intent.kind) {
    case 'sign_in':
      // Regra 1 (o vínculo é pelo `sub`, nunca pelo e-mail), 2, 2b e 5.
      if (f.bySub !== null) return { kind: 'sign_in', userId: f.bySub.id }
      return porEmail(f.byEmail) ?? recusa('unknown_google')
    case 'store_signup':
      if (f.store === null) return recusa('store_unavailable')
      if (f.bySub !== null) return { kind: 'sign_in', userId: f.bySub.id }
      // Regra 4: nenhuma pessoa com este Google nem este e-mail: cria.
      return porEmail(f.byEmail) ?? { kind: 'create' }
    case 'invite':
      // Regra 3.
      if (f.invite === null) return recusa('invite_invalid')
      if (f.bySub !== null) return recusa('google_taken')
      if (email !== f.invite.email.toLowerCase()) return recusa('email_mismatch')
      return { kind: 'activate', userId: f.invite.userId }
    case 'link':
      // Regra 6.
      if (f.current === null) return recusa('not_signed_in')
      if (f.current.googleSub !== null) return recusa('already_linked')
      if (f.bySub !== null && f.bySub.id !== f.current.id) return recusa('google_taken')
      if (email !== f.current.email.toLowerCase()) return recusa('email_mismatch')
      return { kind: 'link', userId: f.current.id }
    case 'calendar':
      // Ligar a agenda: o Google que respondeu tem de ser o vinculado à conta da pessoa (e ela, da equipe).
      if (f.current === null) return recusa('not_signed_in')
      if (f.current.googleSub === null) return recusa('calendar_needs_google')
      if (f.identity.sub !== f.current.googleSub) return recusa('calendar_wrong_google')
      if (!f.currentIsStaff) return recusa('calendar_staff_only')
      return { kind: 'calendar', userId: f.current.id }
  }
}
