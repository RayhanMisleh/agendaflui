import { prisma } from '@/server/db/client'
import { getWeekSchedule, setWeekSchedule } from '@/server/domain/team/working-hours'
import { WEEKDAYS } from '@/server/time'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import {
  ctxWithRole,
  makeBusiness,
  makeCtx,
  makeProfessional,
  makeWorkingHours,
  memberOf,
} from '../setup/factories'

beforeEach(resetDb)

const MANHA = { startMin: 540, endMin: 720 }
const TARDE = { startMin: 780, endMin: 1080 }

describe('getWeekSchedule', () => {
  test('devolve os sete dias, vazios quando não atende, com intervalos ordenados', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    await makeWorkingHours(b.id, p.id, 'MONDAY', [TARDE, MANHA])
    const semana = await getWeekSchedule(ctx, p.id)
    expect(Object.keys(semana)).toEqual([...WEEKDAYS])
    expect(semana.MONDAY).toEqual([MANHA, TARDE])
    expect(semana.SUNDAY).toEqual([])
    expect(semana.SATURDAY).toEqual([])
  })

  test('cliente não vê a escala; profissional inexistente ou de outra conta dá not_found', async () => {
    const b = await makeBusiness()
    const outra = await makeBusiness()
    const p = await makeProfessional(b.id)
    const alheio = await makeProfessional(outra.id)
    const cliente = await makeCtx(b, { actor: { kind: 'customer', customerId: crypto.randomUUID(), name: 'C' } })
    expect((await domainError(getWeekSchedule(cliente, p.id))).code).toBe('forbidden')
    const ctx = await makeCtx(b)
    expect((await domainError(getWeekSchedule(ctx, alheio.id))).code).toBe('not_found')
    expect((await domainError(getWeekSchedule(ctx, 'xyz'))).code).toBe('not_found')
  })

  test('qualquer membro da equipe lê a escala de um colega', async () => {
    const b = await makeBusiness()
    const p = await makeProfessional(b.id)
    await makeWorkingHours(b.id, p.id, 'FRIDAY', [MANHA])
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    expect((await getWeekSchedule(prof, p.id)).FRIDAY).toEqual([MANHA])
  })
})

describe('setWeekSchedule', () => {
  test('preenche a segunda e deixa os outros dias vazios', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const semana = await setWeekSchedule(ctx, p.id, { MONDAY: [TARDE, MANHA] })
    expect(semana.MONDAY).toEqual([MANHA, TARDE])
    for (const d of WEEKDAYS.filter((x) => x !== 'MONDAY')) expect(semana[d]).toEqual([])
    expect(await getWeekSchedule(ctx, p.id)).toEqual(semana)
    expect(await prisma.auditLog.count({ where: { businessId: b.id, action: 'working_hours.updated' } })).toBe(1)
  })

  test('trocar a segunda não muda a terça; lista vazia limpa o dia', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    await setWeekSchedule(ctx, p.id, { MONDAY: [MANHA], TUESDAY: [TARDE] })
    const depois = await setWeekSchedule(ctx, p.id, { MONDAY: [{ startMin: 600, endMin: 660 }] })
    expect(depois.MONDAY).toEqual([{ startMin: 600, endMin: 660 }])
    expect(depois.TUESDAY).toEqual([TARDE])
    const limpa = await setWeekSchedule(ctx, p.id, { TUESDAY: [] })
    expect(limpa.TUESDAY).toEqual([])
    expect(limpa.MONDAY).toHaveLength(1)
  })

  test('aceita passo de 5, expediente até 1440 e intervalos que se encostam', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const s = await setWeekSchedule(ctx, p.id, {
      MONDAY: [{ startMin: 545, endMin: 720 }, { startMin: 720, endMin: 780 }],
      TUESDAY: [{ startMin: 0, endMin: 1440 }],
    })
    expect(s.MONDAY).toEqual([{ startMin: 545, endMin: 720 }, { startMin: 720, endMin: 780 }])
    expect(s.TUESDAY).toEqual([{ startMin: 0, endMin: 1440 }])
  })

  test('recusa sobreposição, passo errado, limites e excesso de intervalos', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    const sobre = await domainError(
      setWeekSchedule(ctx, p.id, { MONDAY: [MANHA, { startMin: 700, endMin: 800 }] }),
    )
    expect(sobre.code).toBe('validation')
    expect(sobre.fields).toHaveProperty('MONDAY')
    expect((await domainError(setWeekSchedule(ctx, p.id, { MONDAY: [{ startMin: 547, endMin: 600 }] }))).code).toBe(
      'validation',
    )
    expect((await domainError(setWeekSchedule(ctx, p.id, { MONDAY: [{ startMin: 600, endMin: 1441 }] }))).code).toBe(
      'validation',
    )
    expect((await domainError(setWeekSchedule(ctx, p.id, { MONDAY: [{ startMin: 600, endMin: 600 }] }))).code).toBe(
      'validation',
    )
    expect((await domainError(setWeekSchedule(ctx, p.id, { MONDAY: [{ startMin: -5, endMin: 60 }] }))).code).toBe(
      'validation',
    )
    const sete = Array.from({ length: 7 }, (_, i) => ({ startMin: i * 60, endMin: i * 60 + 30 }))
    expect((await domainError(setWeekSchedule(ctx, p.id, { MONDAY: sete }))).code).toBe('validation')
    expect(await prisma.workingHours.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('falha numa semana inválida não altera os dias já gravados', async () => {
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    const p = await makeProfessional(b.id)
    await setWeekSchedule(ctx, p.id, { MONDAY: [MANHA] })
    await domainError(setWeekSchedule(ctx, p.id, { MONDAY: [TARDE], TUESDAY: [{ startMin: 1, endMin: 60 }] }))
    expect((await getWeekSchedule(ctx, p.id)).MONDAY).toEqual([MANHA])
  })

  test('profissional altera o próprio expediente mas não o do colega; gerente altera qualquer um', async () => {
    const b = await makeBusiness()
    const prof = await ctxWithRole(b, 'PROFESSIONAL')
    const meu = await makeProfessional(b.id, { membershipId: memberOf(prof).membershipId })
    const colega = await makeProfessional(b.id)
    expect((await setWeekSchedule(prof, meu.id, { MONDAY: [MANHA] })).MONDAY).toEqual([MANHA])
    expect((await domainError(setWeekSchedule(prof, colega.id, { MONDAY: [MANHA] }))).code).toBe('forbidden')
    const gerente = await ctxWithRole(b, 'MANAGER')
    expect((await setWeekSchedule(gerente, colega.id, { MONDAY: [MANHA] })).MONDAY).toEqual([MANHA])
  })
})
