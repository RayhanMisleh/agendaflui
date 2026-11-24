import { prisma } from '@/server/db/client'
import { entrarComoCliente } from './cliente'
import { makeBusiness, makeCustomer, makePet, makeProfessional, makeService, makeServicePrice, makeWorkingHours } from './factories'

/** Segunda-feira, 08:00 em São Paulo. A próxima segunda (23/11) tem expediente 09:00–18:00 com a grade de 30 min. */
export const AGORA = new Date('2026-11-16T11:00:00Z')
export const SEGUNDA = '2026-11-23'
/** 23/11 às 14:00 em São Paulo. */
export const as14h = new Date('2026-11-23T17:00:00Z')

/**
 * Loja de pet shop com Banho por porte (médio R$ 65,00/1 h; gato R$ 70,00), a profissional Ana na segunda, e a cliente
 * Marina com o cão Thor (médio) e a gata Mel. Entra como Marina no `jar`. Quem chama liga o relógio falso antes (`AGORA`).
 */
export async function cenaPet(jar: Map<string, string>, o: { servesCats?: boolean; autoConfirm?: boolean; slug?: string } = {}) {
  const b = await makeBusiness({ niche: 'PET', ...(o.slug ? { slug: o.slug } : {}) })
  await prisma.businessSettings.update({
    where: { businessId: b.id },
    data: { slotStepMin: 30, autoConfirm: o.autoConfirm ?? true, ...(o.servesCats ? { nicheOptions: { servesCats: true } } : {}) },
  })
  const banho = await makeService(b.id, { name: 'Banho', priceCents: 6500, durationMin: 60 })
  await makeServicePrice(b.id, banho.id, 'DOG_MEDIUM', { priceCents: 6500, durationMin: 60 })
  await makeServicePrice(b.id, banho.id, 'CAT', { priceCents: 7000, durationMin: 60 })
  const ana = await makeProfessional(b.id, { name: 'Ana', serviceIds: [banho.id] })
  await makeWorkingHours(b.id, ana.id, 'MONDAY', [{ startMin: 540, endMin: 1080 }])
  const cliente = await makeCustomer(b.id, { name: 'Marina Souza' })
  const pessoa = await entrarComoCliente(jar, b.id, cliente.id)
  const thor = await makePet(b.id, cliente.id, { name: 'Thor', size: 'MEDIUM' })
  const mel = await makePet(b.id, cliente.id, { name: 'Mel', species: 'CAT', size: null })
  const loja = await prisma.business.findUniqueOrThrow({ where: { id: b.id } })
  return { b, slug: loja.slug, banho, ana, cliente, pessoa, thor, mel }
}

export type CenaPet = Awaited<ReturnType<typeof cenaPet>>
