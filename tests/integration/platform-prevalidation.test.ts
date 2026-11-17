import { beforeEach, describe, expect, test } from 'vitest'
import type { Actor } from '@/server/auth/actor'
import { validateApiKeyName } from '@/server/domain/platform/api-keys'
import { listBusinesses, validateNewBusiness } from '@/server/domain/platform/businesses'
import { validateAccountSetup } from '@/server/domain/platform/customization'
import { resetDb } from '../setup/db'
import { makeBusiness, makePlatformAdmin } from '../setup/factories'

type Admin = Extract<Actor, { kind: 'platform_admin' }>
let admin: Admin

beforeEach(async () => {
  await resetDb()
  const a = await makePlatformAdmin()
  admin = { kind: 'platform_admin', adminId: a.id, name: a.name }
})

const setup = {
  brand: { displayName: 'Pata Viva', primary: '#2F6B4F', accent: '#E8833A', material: 'LINEN', paper: 'CREAM', fontPair: 'FRIENDLY', loginMessage: null },
  terms: { professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores', pointsSingular: 'Patinha', pointsPlural: 'Patinhas', club: 'Clube' },
  modules: { loyalty: true, banners: false, store: true, vouchers: true },
  rules: { slotStepMin: 30, minLeadMin: 60, maxAdvanceDays: 60, customerChangeWindowMin: 120, bufferMin: 0, autoConfirm: true },
} as const

describe('validateAccountSetup usa os mesmos esquemas das funções de escrita', () => {
  test('dados válidos não têm erro', () => {
    expect(validateAccountSetup(structuredClone(setup) as never)).toEqual({})
  })

  test('cada regra devolve o erro no campo certo, e vários erros vêm juntos', () => {
    const ruim = {
      brand: { ...setup.brand, displayName: '<b>x</b>', primary: 'vermelho', loginMessage: 'x'.repeat(281) },
      terms: { ...setup.terms, club: '', professionalSingular: 'x'.repeat(31) },
      modules: { loyalty: false, banners: false, store: false, vouchers: true },
      rules: { ...setup.rules, slotStepMin: 7, bufferMin: 3 },
    }
    const e = validateAccountSetup(ruim as never)
    expect(Object.keys(e).sort()).toEqual(['bufferMin', 'club', 'displayName', 'loginMessage', 'primary', 'professionalSingular', 'slotStepMin', 'store', 'vouchers'])
    expect(e.vouchers).toMatch(/Loja/)
    expect(e.primary).toMatch(/#rrggbb/)
  })

  test('é o mesmo texto que a função de escrita daria (um esquema só)', async () => {
    const { updateTerms } = await import('@/server/domain/platform/customization')
    const conta = await makeBusiness()
    const e = validateAccountSetup({ ...structuredClone(setup), terms: { ...setup.terms, club: '' } } as never)
    await expect(updateTerms(admin, conta.id, { ...setup.terms, club: '' })).rejects.toMatchObject({ fields: { club: e.club } })
  })
})

describe('validateNewBusiness e validateApiKeyName', () => {
  const novo = { name: 'Pata Viva', slug: 'pata-viva', timeZone: 'America/Sao_Paulo', owner: { name: 'Marina', email: 'marina@exemplo.test' } }

  test('dados válidos não têm erro; slug, fuso e e-mail do dono ruins aparecem nos campos', () => {
    expect(validateNewBusiness(novo)).toEqual({})
    const e = validateNewBusiness({ ...novo, slug: 'A', timeZone: 'Marte/Olympus', owner: { name: '', email: 'sem-arroba' } })
    expect(Object.keys(e).sort()).toEqual(['owner.email', 'owner.name', 'slug', 'timeZone'])
  })

  test('nome da chave: de 1 a 80 caracteres', () => {
    expect(validateApiKeyName('App Pata Viva')).toBeNull()
    expect(validateApiKeyName('   ')).toMatch(/nome/i)
    expect(validateApiKeyName('x'.repeat(81))).toMatch(/80/)
  })
})

describe('listBusinesses normaliza a busca', () => {
  test('NUL e outros caracteres de controle não derrubam a consulta; busca enorme é cortada', async () => {
    await makeBusiness({ name: 'Pata Viva', slug: 'pata-viva' })
    const nul = await listBusinesses(admin, { search: '\u0000' })
    expect(nul.items).toHaveLength(1) // sobra busca vazia: lista tudo
    const meio = await listBusinesses(admin, { search: 'pa\u0000ta\u0007-\tviva' })
    expect(meio.items.map((c) => c.slug)).toEqual(['pata-viva'])
    await expect(listBusinesses(admin, { search: 'a'.repeat(5000) })).resolves.toMatchObject({ items: [] })
  })
})
