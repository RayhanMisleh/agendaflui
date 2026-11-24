import sharp from 'sharp'
import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { anonymizeCustomer, createCustomerWithPet, listCustomers } from '@/server/domain/customers/customers'
import {
  MAX_ACTIVE_PETS,
  archivePet,
  createPet,
  getPet,
  listMyPets,
  listPets,
  listPetsByCustomers,
  loadPetForBooking,
  restorePet,
  updatePet,
} from '@/server/domain/pets/pets'
import { setPetPhoto } from '@/server/domain/pets/photo'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer, makePet } from '../setup/factories'

const AGORA = new Date('2026-11-16T11:00:00Z')
beforeEach(resetDb)

async function conta(niche: 'PET' | null = 'PET') {
  const b = await makeBusiness(niche ? { niche } : {})
  const dono = await ctxWithRole(b, 'OWNER', { now: AGORA })
  const cliente = await makeCustomer(b.id, { name: 'Marina' })
  return { b, dono, cliente }
}
const clienteCtx = (b: { id: string }, c: { id: string; name: string }) =>
  makeCtx(b, { actor: { kind: 'customer', customerId: c.id, name: c.name }, now: AGORA })
const png = async () => ({ bytes: new Uint8Array(await sharp({ create: { width: 32, height: 32, channels: 3, background: '#0e4f5c' } }).png().toBuffer()) })

describe('pets: gato só onde a loja atende', () => {
  test('cliente não cria nem vira gato com a loja sem gatos; a equipe e a loja com gatos podem', async () => {
    const { b, dono, cliente } = await conta()
    const c = await clienteCtx(b, cliente)
    const barrado = await domainError(createPet(c, cliente.id, { name: 'Mia', species: 'CAT' }))
    expect(barrado).toMatchObject({ code: 'conflict', fields: { species: 'A loja não atende gatos no momento.' } })
    const cao = await createPet(c, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL' })
    expect((await domainError(updatePet(c, cao.id, { species: 'CAT' }))).code).toBe('conflict')
    expect((await createPet(dono, cliente.id, { name: 'Mia', species: 'CAT' })).typeLabel).toBe('Gato')
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: true } } })
    expect((await createPet(c, cliente.id, { name: 'Bia', species: 'CAT' })).typeLabel).toBe('Gato')
  })
})

describe('pets: criar e validar', () => {
  test('dono cria cão médio com rótulos e idade', async () => {
    const { dono, cliente } = await conta()
    const p = await createPet(dono, cliente.id, { name: '  Thor ', species: 'DOG', size: 'MEDIUM', birthMonth: '2023-05', breed: 'Poodle' })
    expect(p.name).toBe('Thor')
    expect(p.typeLabel).toBe('Cão médio')
    expect(p.rangeLabel).toBe('10 a 25 kg')
    expect(p.variant).toBe('DOG_MEDIUM')
    expect(p.birthMonth).toBe('2023-05')
    expect(p.ageLabel).toBe('3 anos')
    expect(p.photoUrl).toBeNull()
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'pet.created' } })
    expect(JSON.stringify(log.metadata)).not.toContain('Thor')
  })

  test('cão sem porte e gato com porte são recusados com a mensagem do campo', async () => {
    const { dono, cliente } = await conta()
    expect((await domainError(createPet(dono, cliente.id, { name: 'Rex', species: 'DOG' }))).fields).toEqual({ size: 'Escolha o porte.' })
    expect((await domainError(createPet(dono, cliente.id, { name: 'Mia', species: 'CAT', size: 'SMALL' }))).fields).toEqual({ size: 'Gato não tem porte.' })
    expect((await createPet(dono, cliente.id, { name: 'Mia', species: 'CAT' })).typeLabel).toBe('Gato')
  })

  test('mês de nascimento futuro ou antigo demais → validation fields.birthMonth', async () => {
    const { dono, cliente } = await conta()
    const futuro = await domainError(createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL', birthMonth: '2026-12' }))
    expect(futuro.code).toBe('validation')
    expect(futuro.fields?.['birthMonth']).toBe('Informe um mês que já passou.')
    expect((await domainError(createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL', birthMonth: '1980-01' }))).fields?.['birthMonth']).toBeDefined()
    await expect(createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL', birthMonth: '2026-11' })).resolves.toBeDefined()
  })

  test('nome vazio e nome grande demais', async () => {
    const { dono, cliente } = await conta()
    expect((await domainError(createPet(dono, cliente.id, { name: '  ', species: 'CAT' }))).fields?.['name']).toBeDefined()
    expect((await domainError(createPet(dono, cliente.id, { name: 'x'.repeat(41), species: 'CAT' }))).fields?.['name']).toBeDefined()
  })

  test('conta sem nicho: createPet → niche_unavailable', async () => {
    const { dono, cliente } = await conta(null)
    const e = await domainError(createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL' }))
    expect(e.reason).toBe('niche_unavailable')
  })

  test('cliente arquivado: recusa com a mensagem da equipe', async () => {
    const { dono, cliente } = await conta()
    await prisma.customer.update({ where: { id: cliente.id }, data: { archivedAt: AGORA } })
    const e = await domainError(createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL' }))
    expect(e.message).toBe('Este cliente está arquivado. Restaure antes de adicionar pets.')
  })
})

describe('pets: permissões', () => {
  test('profissional lê pets (view_clients) mas não cria (forbidden)', async () => {
    const { b, dono, cliente } = await conta()
    await createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL' })
    const prof = await ctxWithRole(b, 'PROFESSIONAL', { now: AGORA })
    expect(await listPets(prof, cliente.id)).toHaveLength(1)
    expect((await domainError(createPet(prof, cliente.id, { name: 'Max', species: 'DOG', size: 'SMALL' }))).code).toBe('forbidden')
  })

  test('cliente cria e lista só os próprios; pet de outro cliente → not_found', async () => {
    const { b, dono, cliente } = await conta()
    const outro = await makeCustomer(b.id, { name: 'Outro' })
    const alheio = await makePet(b.id, outro.id, { name: 'Alheio' })
    const eu = await clienteCtx(b, cliente)
    const meu = await createPet(eu, cliente.id, { name: 'Bolt', species: 'DOG', size: 'LARGE' })
    expect((await listMyPets(eu)).map((p) => p.name)).toEqual(['Bolt'])
    expect((await domainError(getPet(eu, alheio.id))).code).toBe('not_found')
    expect((await domainError(updatePet(eu, alheio.id, { name: 'X' }))).code).toBe('not_found')
    expect((await domainError(archivePet(eu, alheio.id))).code).toBe('not_found')
    expect((await domainError(createPet(eu, outro.id, { name: 'X', species: 'CAT' }))).code).toBe('not_found')
    expect((await domainError(listPets(eu, outro.id))).code).toBe('not_found')
    expect(await updatePet(eu, meu.id, { breed: 'Labrador' })).toMatchObject({ breed: 'Labrador' })
    expect((await getPet(dono, alheio.id)).name).toBe('Alheio')
  })

  test('visitante não lista nem cria', async () => {
    const { b, cliente } = await conta()
    const visitante = await makeCtx(b, { actor: { kind: 'guest' }, channel: 'app' })
    expect((await domainError(listPets(visitante, cliente.id))).code).toBe('forbidden')
  })
})

describe('pets: arquivar, limite e reserva', () => {
  test('arquivar some da lista padrão; includeArchived traz; restaurar volta', async () => {
    const { dono, cliente } = await conta()
    const p = await createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL' })
    await archivePet(dono, p.id)
    await archivePet(dono, p.id)
    expect(await listPets(dono, cliente.id)).toHaveLength(0)
    expect((await listPets(dono, cliente.id, { includeArchived: true }))[0]?.archived).toBe(true)
    expect((await restorePet(dono, p.id)).archived).toBe(false)
    expect(await listPets(dono, cliente.id)).toHaveLength(1)
  })

  test('21º pet ativo → validation; arquivar um libera', async () => {
    const { b, dono, cliente } = await conta()
    for (let i = 0; i < MAX_ACTIVE_PETS; i++) await makePet(b.id, cliente.id)
    const e = await domainError(createPet(dono, cliente.id, { name: 'Extra', species: 'CAT' }))
    expect(e.code).toBe('validation')
    expect(e.message).toBe('Este cliente já tem 20 pets ativos. Arquive algum antes.')
    const [primeiro] = await listPets(dono, cliente.id)
    await archivePet(dono, primeiro!.id)
    await expect(createPet(dono, cliente.id, { name: 'Extra', species: 'CAT' })).resolves.toBeDefined()
  })

  test('loadPetForBooking recusa pet arquivado e pet de outro cliente', async () => {
    const { b, dono, cliente } = await conta()
    const outro = await makeCustomer(b.id)
    const ativo = await makePet(b.id, cliente.id, { size: 'GIANT' })
    const arquivado = await makePet(b.id, cliente.id, { archivedAt: AGORA })
    expect(await loadPetForBooking(dono.db, { petId: ativo.id, customerId: cliente.id })).toMatchObject({ id: ativo.id, variant: 'DOG_GIANT' })
    await expect(loadPetForBooking(dono.db, { petId: arquivado.id, customerId: cliente.id })).rejects.toMatchObject({ code: 'validation', message: 'Escolha um pet deste cliente.' })
    await expect(loadPetForBooking(dono.db, { petId: ativo.id, customerId: outro.id })).rejects.toMatchObject({ code: 'validation' })
  })

  test('updatePet: trocar para gato exige tirar o porte; parte dos campos não mexe nos outros', async () => {
    const { dono, cliente } = await conta()
    const p = await createPet(dono, cliente.id, { name: 'Rex', species: 'DOG', size: 'SMALL', breed: 'Poodle' })
    const gato = await updatePet(dono, p.id, { species: 'CAT' })
    expect(gato).toMatchObject({ species: 'CAT', size: null, breed: 'Poodle' })
    expect((await domainError(updatePet(dono, p.id, { species: 'DOG' }))).fields).toEqual({ size: 'Escolha o porte.' })
    expect(await updatePet(dono, p.id, { breed: '' })).toMatchObject({ breed: null })
  })
})

describe('pets na lista de clientes e no cadastro', () => {
  test('listCustomers acha a dona pelo nome do pet', async () => {
    const { b, dono, cliente } = await conta()
    await makeCustomer(b.id, { name: 'Zeca' })
    await createPet(dono, cliente.id, { name: 'Thor', species: 'DOG', size: 'LARGE' })
    const r = await listCustomers(dono, { search: 'thor' })
    expect(r.items.map((c) => c.name)).toEqual(['Marina'])
  })

  test('listPetsByCustomers agrupa os ativos', async () => {
    const { b, dono, cliente } = await conta()
    const outro = await makeCustomer(b.id)
    await makePet(b.id, cliente.id, { name: 'A' })
    await makePet(b.id, cliente.id, { name: 'B', archivedAt: AGORA })
    const mapa = await listPetsByCustomers(dono, [cliente.id, outro.id])
    expect(mapa.get(cliente.id)?.map((p) => p.name)).toEqual(['A'])
    expect(mapa.has(outro.id)).toBe(false)
  })

  test('createCustomerWithPet grava os dois; falha no pet (cão sem porte) não deixa cliente gravado', async () => {
    const { b, dono } = await conta()
    const ok = await createCustomerWithPet(dono, { name: 'Lia' }, { name: 'Nina', species: 'DOG', size: 'SMALL' })
    expect(ok.pet.customerId).toBe(ok.customer.id)
    const e = await domainError(createCustomerWithPet(dono, { name: 'Bia' }, { name: 'Rex', species: 'DOG' }))
    expect(e.fields).toEqual({ size: 'Escolha o porte.' })
    expect(await prisma.customer.count({ where: { businessId: b.id, name: 'Bia' } })).toBe(0)
    // Falha no meio da transação (e-mail repetido) também desfaz o conjunto.
    await prisma.customer.update({ where: { id: ok.customer.id }, data: { email: 'lia@exemplo.test' } })
    await domainError(createCustomerWithPet(dono, { name: 'Bia', email: 'lia@exemplo.test' }, { name: 'Rex', species: 'DOG', size: 'SMALL' }))
    expect(await prisma.pet.count({ where: { businessId: b.id, name: 'Rex' } })).toBe(0)
  })

  test('anonymizeCustomer: pets viram "Pet", sem raça, cuidados e foto, arquivados', async () => {
    const { b, dono, cliente } = await conta()
    const p = await createPet(dono, cliente.id, { name: 'Thor', species: 'DOG', size: 'LARGE', breed: 'Labrador', careNotes: 'Alergia', birthMonth: '2022-01' })
    await setPetPhoto(dono, p.id, await png())
    await anonymizeCustomer(dono, cliente.id)
    const depois = await prisma.pet.findUniqueOrThrow({ where: { id: p.id } })
    expect(depois).toMatchObject({ name: 'Pet', searchName: 'pet', breed: null, careNotes: null, birthMonth: null, photoUploadId: null })
    expect(depois.archivedAt).not.toBeNull()
    expect(await prisma.upload.count({ where: { businessId: b.id } })).toBe(0)
  })
})

describe('foto do pet', () => {
  test('grava e troca a foto; photoUrl aparece na visão; remover limpa', async () => {
    const { b, dono, cliente } = await conta()
    const p = await createPet(dono, cliente.id, { name: 'Thor', species: 'DOG', size: 'LARGE' })
    await setPetPhoto(dono, p.id, await png())
    const v1 = await getPet(dono, p.id)
    expect(v1.photoUrl).toMatch(/^\/arquivos\//)
    await setPetPhoto(dono, p.id, await png())
    expect(await prisma.upload.count({ where: { businessId: b.id } })).toBe(1)
    await setPetPhoto(dono, p.id, null)
    expect((await getPet(dono, p.id)).photoUrl).toBeNull()
    expect(await prisma.upload.count({ where: { businessId: b.id } })).toBe(0)
  })

  test('cliente troca a foto do próprio pet, não a de outro; arquivo inválido vira validation', async () => {
    const { b, dono, cliente } = await conta()
    const outro = await makeCustomer(b.id)
    const meu = await createPet(dono, cliente.id, { name: 'Thor', species: 'DOG', size: 'LARGE' })
    const alheio = await makePet(b.id, outro.id)
    const eu = await clienteCtx(b, cliente)
    await setPetPhoto(eu, meu.id, await png())
    expect((await domainError(setPetPhoto(eu, alheio.id, await png()))).code).toBe('not_found')
    expect((await domainError(setPetPhoto(dono, meu.id, { bytes: new Uint8Array([1, 2, 3]) }))).code).toBe('validation')
  })
})
