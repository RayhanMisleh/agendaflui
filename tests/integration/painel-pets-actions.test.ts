import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeCustomer, makePet } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw Object.assign(new Error(`NEXT_REDIRECT ${destino}`), { digest: `NEXT_REDIRECT;replace;${destino};307;` }) }) }
})

import { arquivarPet, criarPet, editarPet, restaurarPet } from '@/app/app/painel/clientes/[id]/pets/actions'
import * as rotaFoto from '@/app/app/painel/clientes/[id]/pets/[petId]/foto/route'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'
const OK = { host: 'app.localhost:3000', origin: 'http://app.localhost:3000' }

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let businessId: string
let clienteId: string
beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ niche: 'PET' })).id
  clienteId = (await makeCustomer(businessId)).id
  guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'OWNER'))
})
afterEach(() => guards.requireTenant.mockReset())

describe('criar e editar pet', () => {
  test('criarPet grava cão grande e redireciona para a página do pet com ?novo=1', async () => {
    await expect(criarPet(ini, form({ customerId: clienteId, name: 'Thor', species: 'DOG', size: 'LARGE', coat: 'LONG', breed: 'Labrador' }))).rejects.toThrow(
      new RegExp(`NEXT_REDIRECT /painel/clientes/${clienteId}/pets/[0-9a-f-]{36}\\?novo=1`),
    )
    const p = await prisma.pet.findFirstOrThrow({ where: { businessId } })
    expect(p).toMatchObject({ name: 'Thor', species: 'DOG', size: 'LARGE', coat: 'LONG', breed: 'Labrador', customerId: clienteId })
  })

  test('criarPet de cão sem porte devolve fields.size "Escolha o porte."', async () => {
    const r = await criarPet(ini, form({ customerId: clienteId, name: 'Rex', species: 'DOG', size: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields.size).toBe('Escolha o porte.')
    expect(r.values.name).toBe('Rex')
    expect(await prisma.pet.count()).toBe(0)
  })

  test('profissional recebe sem permissão em criarPet; editarPet de pet de outra conta → não encontrado', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    const negado = await criarPet(ini, form({ customerId: clienteId, name: 'Rex', species: 'DOG', size: 'SMALL' }))
    expect(negado.message).toBe(NEGADO)
    expect(await prisma.pet.count()).toBe(0)

    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'OWNER'))
    const outra = await makeBusiness({ niche: 'PET' })
    const alheio = await makePet(outra.id, (await makeCustomer(outra.id)).id, { name: 'Alheio' })
    const r = await editarPet(ini, form({ petId: alheio.id, name: 'Invadido', species: 'DOG', size: 'SMALL' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe('Pet não encontrado.')
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: alheio.id } })).name).toBe('Alheio')
  })

  test('editarPet troca a espécie para gato (sem porte) e confirma com "Pet salvo."', async () => {
    const pet = await makePet(businessId, clienteId, { name: 'Mel' })
    const r = await editarPet(ini, form({ petId: pet.id, customerId: clienteId, name: 'Mel', species: 'CAT', size: '', careNotes: 'Medo de secador' }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Pet salvo.')
    expect(await prisma.pet.findUniqueOrThrow({ where: { id: pet.id } })).toMatchObject({ species: 'CAT', size: null, careNotes: 'Medo de secador' })
  })

  test('arquivarPet e restaurarPet mudam archived', async () => {
    const pet = await makePet(businessId, clienteId, { name: 'Bidu' })
    expect((await arquivarPet(ini, form({ petId: pet.id }))).message).toBe('Pet arquivado.')
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: pet.id } })).archivedAt).not.toBeNull()
    expect((await restaurarPet(ini, form({ petId: pet.id }))).message).toBe('Pet restaurado.')
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: pet.id } })).archivedAt).toBeNull()
  })
})

describe('foto do pet', () => {
  function pedido(petId: string, campos: Record<string, string | File>, headers: Record<string, string> = OK) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(campos)) fd.set(k, v)
    return [
      new Request(`http://app.localhost:3000/painel/clientes/${clienteId}/pets/${petId}/foto`, { method: 'POST', headers, body: fd }),
      { params: Promise.resolve({ id: clienteId, petId }) },
    ] as const
  }

  test('a rota só aceita POST', () => {
    expect(Object.keys(rotaFoto)).toEqual(['POST'])
  })

  test('rota de foto: arquivo grande demais volta com ?foto=too_large', async () => {
    const pet = await makePet(businessId, clienteId)
    const grande = new File([new Uint8Array(8 * 1024 * 1024 + 10)], 'g.png', { type: 'image/png' })
    const r = await rotaFoto.POST(...pedido(pet.id, { file: grande }))
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe(`/painel/clientes/${clienteId}/pets/${pet.id}?foto=too_large`)
    expect(await prisma.upload.count()).toBe(0)
  })

  test('sem arquivo volta no_file e origem de outro site recebe 403', async () => {
    const pet = await makePet(businessId, clienteId)
    expect((await rotaFoto.POST(...pedido(pet.id, {}))).headers.get('location')).toBe(`/painel/clientes/${clienteId}/pets/${pet.id}?foto=no_file`)
    expect((await rotaFoto.POST(...pedido(pet.id, {}, { host: OK.host, origin: 'http://evil.example' }))).status).toBe(403)
  })
})
