import { describe, expect, test } from 'vitest'
import { decideGoogle } from '@/server/auth/google/decide'
import type { GoogleFacts, PersonFact } from '@/server/auth/google/decide'
import type { GoogleIntent } from '@/server/auth/google/flow'

const identidade = { sub: 'g-1', email: 'ana@exemplo.test', emailVerified: true, name: 'Ana' }
const loja = { businessId: 'b-1', slug: 'pet-bom', name: 'Pet Bom' }
const pessoa = (id: string, o: Partial<PersonFact> = {}): PersonFact => ({ id, email: 'ana@exemplo.test', state: 'active', googleSub: null, ...o })

function fatos(o: Partial<GoogleFacts> = {}): GoogleFacts {
  return { identity: identidade, bySub: null, byEmail: null, invite: null, store: loja, current: null, currentIsStaff: false, ...o }
}

const ENTRAR: GoogleIntent = { kind: 'sign_in' }
const LOJA: GoogleIntent = { kind: 'store_signup', slug: 'pet-bom' }
const CONVITE: GoogleIntent = { kind: 'invite', token: 't' }
const VINCULAR: GoogleIntent = { kind: 'link' }
const AGENDA: GoogleIntent = { kind: 'calendar' }

describe('decideGoogle', () => {
  test('regra 10: e-mail não verificado é recusado em todas as intenções, mesmo com Google vinculado', () => {
    const naoVerificado = { ...identidade, emailVerified: false }
    const completos = fatos({
      identity: naoVerificado,
      bySub: pessoa('u-1', { googleSub: 'g-1' }),
      byEmail: pessoa('u-1', { googleSub: 'g-1' }),
      invite: { userId: 'u-2', email: 'ana@exemplo.test' },
      current: pessoa('u-3'),
    })
    for (const intent of [ENTRAR, LOJA, CONVITE, VINCULAR]) {
      expect(decideGoogle(intent, completos), intent.kind).toEqual({ kind: 'refuse', reason: 'email_not_verified' })
    }
  })

  test('regra 1: Google vinculado entra na dona do vínculo (entrar e cadastro na loja)', () => {
    const f = fatos({ bySub: pessoa('u-1', { googleSub: 'g-1' }), byEmail: pessoa('u-1', { googleSub: 'g-1' }) })
    expect(decideGoogle(ENTRAR, f)).toEqual({ kind: 'sign_in', userId: 'u-1' })
    expect(decideGoogle(LOJA, f)).toEqual({ kind: 'sign_in', userId: 'u-1' })
  })

  test('regra 1: Google vinculado cujo e-mail agora é de outra pessoa entra na dona do vínculo', () => {
    const f = fatos({ bySub: pessoa('u-1', { email: 'antigo@exemplo.test', googleSub: 'g-1' }), byEmail: pessoa('u-2', { email: 'ana@exemplo.test' }) })
    expect(decideGoogle(ENTRAR, f)).toEqual({ kind: 'sign_in', userId: 'u-1' })
    expect(decideGoogle(LOJA, f)).toEqual({ kind: 'sign_in', userId: 'u-1' })
  })

  test('regra 2: Google novo com e-mail de conta ativa não entra (entrar e cadastro na loja)', () => {
    const f = fatos({ byEmail: pessoa('u-1', { state: 'active' }) })
    expect(decideGoogle(ENTRAR, f)).toEqual({ kind: 'refuse', reason: 'account_exists' })
    expect(decideGoogle(LOJA, f)).toEqual({ kind: 'refuse', reason: 'account_exists' })
  })

  test('regra 2b: Google novo com e-mail de conta pendente ativa a conta', () => {
    const f = fatos({ byEmail: pessoa('u-1', { state: 'pending' }) })
    expect(decideGoogle(ENTRAR, f)).toEqual({ kind: 'activate', userId: 'u-1' })
    expect(decideGoogle(LOJA, f)).toEqual({ kind: 'activate', userId: 'u-1' })
  })

  test('regra 3: convite aceita o Google do mesmo e-mail', () => {
    const f = fatos({ invite: { userId: 'u-9', email: 'Ana@Exemplo.test' }, byEmail: pessoa('u-9', { state: 'pending' }) })
    expect(decideGoogle(CONVITE, f)).toEqual({ kind: 'activate', userId: 'u-9' })
  })

  test('regra 3: convite recusa outro e-mail', () => {
    const f = fatos({ invite: { userId: 'u-9', email: 'outra@exemplo.test' } })
    expect(decideGoogle(CONVITE, f)).toEqual({ kind: 'refuse', reason: 'email_mismatch' })
  })

  test('regra 3: convite recusa Google ligado a outra pessoa', () => {
    const f = fatos({ invite: { userId: 'u-9', email: 'ana@exemplo.test' }, bySub: pessoa('u-1', { googleSub: 'g-1' }) })
    expect(decideGoogle(CONVITE, f)).toEqual({ kind: 'refuse', reason: 'google_taken' })
  })

  test('regra 3: convite inválido', () => {
    expect(decideGoogle(CONVITE, fatos({ invite: null }))).toEqual({ kind: 'refuse', reason: 'invite_invalid' })
  })

  test('regra 4: cliente novo pela loja cria a pessoa', () => {
    expect(decideGoogle(LOJA, fatos())).toEqual({ kind: 'create' })
  })

  test('regra 4: loja indisponível recusa', () => {
    expect(decideGoogle(LOJA, fatos({ store: null }))).toEqual({ kind: 'refuse', reason: 'store_unavailable' })
  })

  test('regra 5: Google desconhecido na entrada geral não cria conta', () => {
    expect(decideGoogle(ENTRAR, fatos())).toEqual({ kind: 'refuse', reason: 'unknown_google' })
  })

  test('regra 6: vincular aceita o Google do mesmo e-mail', () => {
    expect(decideGoogle(VINCULAR, fatos({ current: pessoa('u-1') }))).toEqual({ kind: 'link', userId: 'u-1' })
  })

  test('regra 6: vincular recusa outro e-mail, Google de outra pessoa, quem já tem Google e quem não está entrado', () => {
    expect(decideGoogle(VINCULAR, fatos({ current: pessoa('u-1', { email: 'outra@exemplo.test' }) }))).toEqual({ kind: 'refuse', reason: 'email_mismatch' })
    expect(decideGoogle(VINCULAR, fatos({ current: pessoa('u-1'), bySub: pessoa('u-2', { googleSub: 'g-1' }) }))).toEqual({ kind: 'refuse', reason: 'google_taken' })
    expect(decideGoogle(VINCULAR, fatos({ current: pessoa('u-1', { googleSub: 'g-0' }) }))).toEqual({ kind: 'refuse', reason: 'already_linked' })
    expect(decideGoogle(VINCULAR, fatos({ current: null }))).toEqual({ kind: 'refuse', reason: 'not_signed_in' })
  })
})

describe('decideGoogle: agenda', () => {
  const equipe = (o: Partial<PersonFact> = {}) => fatos({ current: pessoa('u-1', { googleSub: 'g-1', ...o }), currentIsStaff: true })

  test('agenda: Google vinculado igual e equipe → calendar', () => {
    expect(decideGoogle(AGENDA, equipe())).toEqual({ kind: 'calendar', userId: 'u-1' })
    // O e-mail do Google pode ter mudado: o que vale é o `sub`.
    expect(decideGoogle(AGENDA, { ...equipe(), identity: { ...identidade, email: 'outro@exemplo.test' } })).toEqual({ kind: 'calendar', userId: 'u-1' })
  })

  test('agenda: sem Google vinculado, Google diferente, não é equipe, não entrado e e-mail não verificado são recusados', () => {
    expect(decideGoogle(AGENDA, equipe({ googleSub: null }))).toEqual({ kind: 'refuse', reason: 'calendar_needs_google' })
    expect(decideGoogle(AGENDA, equipe({ googleSub: 'g-2' }))).toEqual({ kind: 'refuse', reason: 'calendar_wrong_google' })
    expect(decideGoogle(AGENDA, { ...equipe(), currentIsStaff: false })).toEqual({ kind: 'refuse', reason: 'calendar_staff_only' })
    expect(decideGoogle(AGENDA, fatos())).toEqual({ kind: 'refuse', reason: 'not_signed_in' })
    expect(decideGoogle(AGENDA, { ...equipe(), identity: { ...identidade, emailVerified: false } })).toEqual({ kind: 'refuse', reason: 'email_not_verified' })
  })
})
