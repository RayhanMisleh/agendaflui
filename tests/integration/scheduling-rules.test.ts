import { prisma } from '@/server/db/client'
import { DomainError } from '@/server/domain/errors'
import { getSchedulingRules, updateSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx, makeMembership, makeUser } from '../setup/factories'

beforeEach(resetDb)

async function erroDe(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    return e as DomainError
  }
  throw new Error('Era esperado um erro, mas a chamada terminou sem erro.')
}

async function ctxComPapel(business: { id: string }, role: 'MANAGER' | 'PROFESSIONAL') {
  const user = await makeUser()
  const m = await makeMembership(business.id, user.id, role)
  return makeCtx(business, {
    actor: { kind: 'member', userId: user.id, membershipId: m.id, name: user.name, role },
  })
}

const PADRAO = {
  slotStepMin: 15,
  minLeadMin: 60,
  maxAdvanceDays: 60,
  customerChangeWindowMin: 120,
  bufferMin: 0,
  autoConfirm: true,
}

describe('regras de agenda', () => {
  test('devolve os padrões da conta', async () => {
    const b = await makeBusiness()
    expect(await getSchedulingRules(await makeCtx(b))).toEqual(PADRAO)
  })

  test('qualquer ator da conta lê, inclusive profissional', async () => {
    const b = await makeBusiness()
    expect(await getSchedulingRules(await ctxComPapel(b, 'PROFESSIONAL'))).toEqual(PADRAO)
  })

  test('gerente altera, grava e audita; o resto fica como estava', async () => {
    const b = await makeBusiness()
    const gerente = await ctxComPapel(b, 'MANAGER')
    const novo = await updateSchedulingRules(gerente, { slotStepMin: 30, bufferMin: 10, autoConfirm: false })
    expect(novo).toEqual({ ...PADRAO, slotStepMin: 30, bufferMin: 10, autoConfirm: false })
    expect(await getSchedulingRules(gerente)).toEqual(novo)
    const linhas = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'scheduling_rules.updated' } })
    expect(linhas).toHaveLength(1)
  })

  test('corpo vazio devolve as regras sem auditar', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect(await updateSchedulingRules(ctx, {})).toEqual(PADRAO)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'scheduling_rules.updated' } })).toBe(0)
  })

  test('profissional não altera', async () => {
    const b = await makeBusiness()
    const prof = await ctxComPapel(b, 'PROFESSIONAL')
    expect((await erroDe(updateSchedulingRules(prof, { bufferMin: 5 }))).code).toBe('forbidden')
    expect(await getSchedulingRules(prof)).toEqual(PADRAO)
  })

  test('altera só a própria conta', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    await updateSchedulingRules(await makeCtx(a), { minLeadMin: 0 })
    expect((await getSchedulingRules(await makeCtx(b))).minLeadMin).toBe(60)
  })

  test('valores inválidos dão validation com o campo certo', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const casos: [Record<string, unknown>, string][] = [
      [{ slotStepMin: 7 }, 'slotStepMin'],
      [{ bufferMin: 7 }, 'bufferMin'],
      [{ bufferMin: 125 }, 'bufferMin'],
      [{ minLeadMin: -1 }, 'minLeadMin'],
      [{ minLeadMin: 10081 }, 'minLeadMin'],
      [{ maxAdvanceDays: 0 }, 'maxAdvanceDays'],
      [{ maxAdvanceDays: 366 }, 'maxAdvanceDays'],
      [{ customerChangeWindowMin: 10081 }, 'customerChangeWindowMin'],
      [{ autoConfirm: 'sim' }, 'autoConfirm'],
    ]
    for (const [input, campo] of casos) {
      const e = await erroDe(updateSchedulingRules(ctx, input))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {})).toContain(campo)
    }
    expect(await getSchedulingRules(ctx)).toEqual(PADRAO)
  })

  test('aceita os extremos válidos', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const r = await updateSchedulingRules(ctx, {
      slotStepMin: 60,
      minLeadMin: 10080,
      maxAdvanceDays: 365,
      customerChangeWindowMin: 0,
      bufferMin: 120,
    })
    expect(r).toMatchObject({ slotStepMin: 60, minLeadMin: 10080, maxAdvanceDays: 365, customerChangeWindowMin: 0, bufferMin: 120 })
  })
})
