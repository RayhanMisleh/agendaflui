import { prisma } from '@/server/db/client'
import { getSchedulingRules, updateSchedulingRules } from '@/server/domain/settings/scheduling-rules'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx } from '../setup/factories'

beforeEach(resetDb)

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
    expect(await getSchedulingRules(await makeCtx(b))).toMatchObject(PADRAO)
  })

  test('qualquer ator da conta lê, inclusive profissional', async () => {
    const b = await makeBusiness()
    expect(await getSchedulingRules(await ctxWithRole(b, 'PROFESSIONAL'))).toMatchObject(PADRAO)
  })

  test('gerente altera, grava e audita; o resto fica como estava', async () => {
    const b = await makeBusiness()
    const gerente = await ctxWithRole(b, 'MANAGER')
    const novo = await updateSchedulingRules(gerente, { slotStepMin: 30, bufferMin: 10, autoConfirm: false })
    expect(novo).toMatchObject({ ...PADRAO, slotStepMin: 30, bufferMin: 10, autoConfirm: false })
    expect(await getSchedulingRules(gerente)).toEqual(novo)
    const linhas = await prisma.auditLog.findMany({ where: { businessId: b.id, action: 'scheduling_rules.updated' } })
    expect(linhas).toHaveLength(1)
  })

  test('campo desconhecido é recusado com validation e nada é gravado', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const e = await domainError(updateSchedulingRules(ctx, { slotStepMin: 30, versao: 3 } as Partial<typeof PADRAO>))
    expect(e.code).toBe('validation')
    expect((await getSchedulingRules(ctx)).slotStepMin).toBe(PADRAO.slotStepMin)
  })

  test('corpo vazio devolve as regras sem auditar', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    expect(await updateSchedulingRules(ctx, {})).toMatchObject(PADRAO)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'scheduling_rules.updated' } })).toBe(0)
  })

  test('profissional não altera', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await domainError(updateSchedulingRules(prof, { bufferMin: 5 }))).code).toBe('forbidden')
    expect(await getSchedulingRules(prof)).toMatchObject(PADRAO)
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
      const e = await domainError(updateSchedulingRules(ctx, input))
      expect(e.code).toBe('validation')
      expect(Object.keys(e.fields ?? {})).toContain(campo)
    }
    expect(await getSchedulingRules(ctx)).toMatchObject(PADRAO)
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
