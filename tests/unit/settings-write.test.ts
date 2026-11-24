import { describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import type { BusinessSettings } from '@/server/db/generated/client'
import { writeSettings, type SettingsTx } from '@/server/domain/settings/versioned'
import { SEM_CONTROLE, SEM_JUNCAO_SOLTA } from '@/server/domain/settings/text-rules'

const ctx = { businessId: 'b1' } as TenantContext
const linha = { businessId: 'b1', version: 4, slotStepMin: 15, autoConfirm: true } as BusinessSettings

function tx(count: number) {
  const findUnique = vi.fn().mockResolvedValue(linha)
  const updateMany = vi.fn().mockResolvedValue({ count })
  const fake = { businessSettings: { findUnique, updateMany }, auditLog: { create: vi.fn() } } satisfies SettingsTx
  return { fake, findUnique, updateMany }
}

describe('writeSettings', () => {
  test('devolve o que foi gravado (linha lida com a mudança e a versão nova), sem reler o banco', async () => {
    const { fake, findUnique, updateMany } = tx(1)
    const r = await writeSettings(fake, ctx, 4, () => ({ data: { slotStepMin: 30 } }))
    expect(r.changed).toBe(true)
    expect(r.row).toMatchObject({ slotStepMin: 30, autoConfirm: true, version: 5 })
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({
      where: { businessId: 'b1', version: 4 },
      data: { slotStepMin: 30, version: { increment: 1 } },
    })
  })

  test('sem mudança não grava e devolve a linha lida', async () => {
    const { fake, updateMany } = tx(1)
    const r = await writeSettings(fake, ctx, undefined, () => null)
    expect([r.changed, r.row.version]).toEqual([false, 4])
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('validadores de texto', () => {
  test('a junção de emoji (U+200D) vale entre dois emojis e sozinha não vale', () => {
    expect(SEM_CONTROLE('👩‍⚕️')).toBe(true)
    expect(SEM_JUNCAO_SOLTA('👩‍⚕️')).toBe(true)
    expect(SEM_JUNCAO_SOLTA('Nome‍')).toBe(false)
    expect(SEM_CONTROLE('a​b')).toBe(false)
  })
})
