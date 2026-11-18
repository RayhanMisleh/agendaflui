import { describe, expect, test } from 'vitest'
import { createFrenetGateway } from '@/server/integrations/frenet'

const Q = { sellerCep: '01310100', recipientCep: '20040020', invoiceValueCents: 5990, items: [{ sku: 'p1', quantity: 1, weightKg: 0.5, lengthCm: 20, heightCm: 10, widthCm: 30 }] }
const servico = (o: Record<string, unknown>) => ({ ServiceCode: 'X', ServiceDescription: 'PAC', Carrier: 'Correios', ShippingPrice: '21.5', DeliveryTime: '7', Error: false, ...o })
const gateway = (...s: unknown[]) => createFrenetGateway({ fetch: async () => new Response(JSON.stringify({ ShippingSevicesArray: s }), { status: 200 }) })

describe('a cotação só oferece o que o token assinado aceita', () => {
  test('prazo até 1.000 dias; acima disso a opção é descartada', async () => {
    const r = await gateway(servico({ ServiceCode: 'A', DeliveryTime: '1000' }), servico({ ServiceCode: 'B', DeliveryTime: '1001' }), servico({ ServiceCode: 'C', DeliveryTime: '9999' })).quote('t-0123456789012345', Q)
    expect(r.map((s) => s.serviceCode)).toEqual(['A'])
  })

  test('frete até R$ 10.000,00; acima disso a opção é descartada', async () => {
    const r = await gateway(servico({ ServiceCode: 'A', ShippingPrice: '10000.00' }), servico({ ServiceCode: 'B', ShippingPrice: '10000.01' }), servico({ ServiceCode: 'C', ShippingPrice: '999999.99' })).quote('t-0123456789012345', Q)
    expect(r.map((s) => [s.serviceCode, s.priceCents])).toEqual([['A', 1_000_000]])
  })

  test('se nenhuma opção cabe, a lista vem vazia (sem erro)', async () => {
    expect(await gateway(servico({ DeliveryTime: '2000' })).quote('t-0123456789012345', Q)).toEqual([])
  })
})
