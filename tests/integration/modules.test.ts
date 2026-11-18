import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { tenantDb } from '@/server/db/tenant'
import { DomainError } from '@/server/domain/errors'
import { isModuleOn, requireModule } from '@/server/domain/modules'
import { MODULE_LABELS, MODULE_NAMES } from '@/shared/modules'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCtx } from '../setup/factories'

beforeEach(resetDb)

const ligar = (businessId: string, data: { loyalty?: boolean; banners?: boolean; store?: boolean; vouchers?: boolean }) =>
  prisma.businessModules.upsert({ where: { businessId }, create: { businessId, ...data }, update: data })

async function falha(p: Promise<unknown>): Promise<DomainError> {
  const erro = await p.then(
    () => null,
    (e: unknown) => e,
  )
  if (!(erro instanceof DomainError)) throw new Error('Esperava um DomainError.')
  return erro
}

describe('módulos da conta', () => {
  test('os quatro módulos têm rótulo em português', () => {
    expect([...MODULE_NAMES]).toEqual(['loyalty', 'banners', 'store', 'vouchers'])
    expect(MODULE_LABELS).toEqual({ loyalty: 'Fidelidade', banners: 'Banners', store: 'Loja', vouchers: 'Vouchers' })
  })

  test('sem linha de módulos, tudo está desligado e requireModule recusa com module_disabled', async () => {
    const conta = await makeBusiness()
    await prisma.businessModules.delete({ where: { businessId: conta.id } })
    const ctx = await makeCtx(conta)
    for (const m of MODULE_NAMES) expect(await isModuleOn(ctx.db, conta.id, m)).toBe(false)
    const erro = await falha(requireModule(ctx, 'store'))
    expect(erro.code).toBe('module_disabled')
    expect(erro.message).toBe('O módulo Loja não está ligado nesta conta.')
  })

  test('módulo ligado passa e os outros continuam recusando', async () => {
    const conta = await makeBusiness()
    await ligar(conta.id, { store: true })
    const ctx = await makeCtx(conta)
    await expect(requireModule(ctx, 'store')).resolves.toBeUndefined()
    expect(await isModuleOn(ctx.db, conta.id, 'store')).toBe(true)
    expect((await falha(requireModule(ctx, 'loyalty'))).code).toBe('module_disabled')
  })

  test('uma conta com a loja ligada e outra desligada não se misturam', async () => {
    const a = await makeBusiness()
    const b = await makeBusiness()
    await ligar(a.id, { store: true })
    await ligar(b.id, { store: false })
    const ctxA = await makeCtx(a)
    const ctxB = await makeCtx(b)
    await expect(requireModule(ctxA, 'store')).resolves.toBeUndefined()
    expect((await falha(requireModule(ctxB, 'store'))).code).toBe('module_disabled')
    // A linha da conta A nunca vale para B, mesmo perguntando com o id de B no cliente de A.
    expect(await isModuleOn(tenantDb(a.id), b.id, 'store')).toBe(false)
  })

  test('aceita uma transação como cliente', async () => {
    const conta = await makeBusiness()
    await ligar(conta.id, { banners: true })
    const ctx = await makeCtx(conta)
    await ctx.db.$transaction(async (tx) => {
      await expect(requireModule(ctx, 'banners', tx)).resolves.toBeUndefined()
      expect((await falha(requireModule(ctx, 'vouchers', tx))).code).toBe('module_disabled')
    })
  })
})

describe('requirePainelModule (páginas do painel)', () => {
  test('módulo desligado: 404 (notFound); ligado: segue', async () => {
    const { requirePainelModule } = await import('@/app/painel/(app)/_lib/modulo')
    const b = await makeBusiness()
    const ctx = await makeCtx(b)
    await expect(requirePainelModule(ctx, 'banners')).rejects.toMatchObject({ digest: expect.stringContaining('404') })
    await ligar(b.id, { banners: true })
    await expect(requirePainelModule(ctx, 'banners')).resolves.toBeUndefined()
    await expect(requirePainelModule(ctx, 'store')).rejects.toMatchObject({ digest: expect.stringContaining('404') })
  })
})
