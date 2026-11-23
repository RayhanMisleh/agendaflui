import { beforeEach, describe, expect, test } from 'vitest'
import { customerLinkUrl } from '@/server/customer-link'
import { getCustomerLink } from '@/server/domain/settings/customer-link'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeCustomer, makeCtx } from '../setup/factories'

beforeEach(resetDb)

describe('getCustomerLink', () => {
  test('dono e gerente recebem o link da loja e o QR que o codifica', async () => {
    const loja = await makeBusiness({ slug: 'patas-felizes' })
    for (const papel of ['OWNER', 'MANAGER'] as const) {
      const link = await getCustomerLink(await ctxWithRole(loja, papel))
      expect(link?.url).toBe(customerLinkUrl('patas-felizes'))
      expect(link?.qrSvg.startsWith('<svg')).toBe(true)
    }
  })

  test('profissional e cliente recebem null', async () => {
    const loja = await makeBusiness({ slug: 'patas-felizes' })
    expect(await getCustomerLink(await ctxWithRole(loja, 'PROFESSIONAL'))).toBeNull()
    const cliente = await makeCustomer(loja.id)
    expect(
      await getCustomerLink(await makeCtx(loja, { actor: { kind: 'customer', customerId: cliente.id, name: cliente.name } })),
    ).toBeNull()
  })

  test('cada loja recebe o link do próprio slug', async () => {
    const a = await makeBusiness({ slug: 'loja-a' })
    const b = await makeBusiness({ slug: 'loja-b' })
    expect((await getCustomerLink(await ctxWithRole(a, 'OWNER')))?.url).toMatch(/\/loja-a$/)
    expect((await getCustomerLink(await ctxWithRole(b, 'OWNER')))?.url).toMatch(/\/loja-b$/)
  })
})
