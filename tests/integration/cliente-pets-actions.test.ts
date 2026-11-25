import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { entrarComoCliente, form } from '../setup/cliente'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makePet } from '../setup/factories'

const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }),
  headers: async () => new Headers(),
}))
vi.mock('next/navigation', () => ({
  redirect: (to: string): never => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${to}`), { to })
  },
  notFound: (): never => {
    throw new Error('NEXT_NOT_FOUND')
  },
  unstable_rethrow: (e: unknown): void => {
    if (e instanceof Error && e.message.startsWith('NEXT_')) throw e
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/server/auth/request-info', () => ({ requestInfo: async () => ({ ip: '203.0.113.7', userAgent: 'teste' }) }))

import { arquivarPet, editarPet, restaurarPet } from '@/app/app/[slug]/(area)/pets/actions'
import { ESTADO_VAZIO } from '@/app/app/[slug]/_lib/estado'

async function montar(o: { servesCats?: boolean } = {}) {
  const b = await makeBusiness({ niche: 'PET' })
  if (o.servesCats) await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: true } } })
  const cliente = await makeCustomer(b.id)
  await entrarComoCliente(jar, b.id, cliente.id)
  const pet = await makePet(b.id, cliente.id, { name: 'Thor', size: 'MEDIUM' })
  return { b, slug: b.slug, cliente, pet }
}

beforeEach(async () => {
  jar.clear()
  await resetDb()
})

describe('Meus pets: ações', () => {
  test('editar muda o porte do próprio pet', async () => {
    const c = await montar()
    const r = await editarPet(c.slug, ESTADO_VAZIO, form({ petId: c.pet.id, name: 'Thor', species: 'DOG', size: 'LARGE', breed: 'Labrador', birthMonth: '', coat: 'SHORT', careNotes: 'Alergia' }))
    expect(r).toMatchObject({ ok: true, message: 'Pet salvo.' })
    expect(await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).toMatchObject({ size: 'LARGE', breed: 'Labrador', coat: 'SHORT', careNotes: 'Alergia' })
  })

  test('editar com campo inválido devolve o erro do campo e mantém o que foi digitado', async () => {
    const c = await montar()
    const r = await editarPet(c.slug, ESTADO_VAZIO, form({ petId: c.pet.id, name: '', species: 'DOG', size: 'LARGE' }))
    expect(r.ok).toBe(false)
    expect(r.fields.name).toBeTruthy()
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).name).toBe('Thor')
  })

  test('editar pet de outro cliente → "Pet não encontrado." e nada muda', async () => {
    const c = await montar()
    const outro = await makeCustomer(c.b.id)
    const alheio = await makePet(c.b.id, outro.id, { name: 'Alheio' })
    const r = await editarPet(c.slug, ESTADO_VAZIO, form({ petId: alheio.id, name: 'Invadido', species: 'DOG', size: 'SMALL' }))
    expect(r).toMatchObject({ ok: false, message: 'Pet não encontrado.' })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: alheio.id } })).name).toBe('Alheio')
    expect(await arquivarPet(c.slug, ESTADO_VAZIO, form({ petId: alheio.id }))).toMatchObject({ ok: false, message: 'Pet não encontrado.' })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: alheio.id } })).archivedAt).toBeNull()
  })

  test('pet de outra loja → "Pet não encontrado."', async () => {
    const c = await montar()
    const outraLoja = await makeBusiness({ niche: 'PET' })
    const alheio = await makePet(outraLoja.id, (await makeCustomer(outraLoja.id)).id, { name: 'Alheio' })
    expect(await editarPet(c.slug, ESTADO_VAZIO, form({ petId: alheio.id, name: 'X', species: 'DOG', size: 'SMALL' }))).toMatchObject({ ok: false, message: 'Pet não encontrado.' })
  })

  test('arquivar e restaurar', async () => {
    const c = await montar()
    expect(await arquivarPet(c.slug, ESTADO_VAZIO, form({ petId: c.pet.id }))).toMatchObject({ ok: true, message: 'Thor arquivado.' })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).archivedAt).not.toBeNull()
    expect(await restaurarPet(c.slug, ESTADO_VAZIO, form({ petId: c.pet.id }))).toMatchObject({ ok: true })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).archivedAt).toBeNull()
  })

  test('restaurar o 21º pet ativo → mensagem de limite', async () => {
    const c = await montar()
    await prisma.pet.update({ where: { id: c.pet.id }, data: { archivedAt: new Date() } })
    for (let i = 0; i < 20; i++) await makePet(c.b.id, c.cliente.id, { name: `Pet ${i}` })
    const r = await restaurarPet(c.slug, ESTADO_VAZIO, form({ petId: c.pet.id }))
    expect(r).toMatchObject({ ok: false, message: 'Você já tem 20 pets ativos. Arquive algum antes.' })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).archivedAt).not.toBeNull()
  })

  test('trocar para gato com gatos desligados é recusado; com gatos ligados troca e some o porte', async () => {
    const c = await montar()
    const r = await editarPet(c.slug, ESTADO_VAZIO, form({ petId: c.pet.id, name: 'Thor', species: 'CAT', size: '' }))
    expect(r).toMatchObject({ ok: false, fields: { species: 'A loja não atende gatos no momento.' } })
    const d = await montar({ servesCats: true })
    jar.clear()
    await entrarComoCliente(jar, d.b.id, d.cliente.id)
    const ok = await editarPet(d.slug, ESTADO_VAZIO, form({ petId: d.pet.id, name: 'Thor', species: 'CAT', size: '' }))
    expect(ok.ok).toBe(true)
    expect(await prisma.pet.findUniqueOrThrow({ where: { id: d.pet.id } })).toMatchObject({ species: 'CAT', size: null })
  })

  test('gato que já existia com gatos desligados ainda pode ter os cuidados editados', async () => {
    const c = await montar()
    const gato = await makePet(c.b.id, c.cliente.id, { name: 'Mel', species: 'CAT', size: null })
    const r = await editarPet(c.slug, ESTADO_VAZIO, form({ petId: gato.id, name: 'Mel', species: 'CAT', size: '', careNotes: 'Dócil' }))
    expect(r.ok).toBe(true)
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: gato.id } })).careNotes).toBe('Dócil')
  })
})
