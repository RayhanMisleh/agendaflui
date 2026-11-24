import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { entrarComoCliente, form } from '../setup/cliente'
import { resetDb } from '../setup/db'
import { makeBusiness, makeCustomer, makePet, makeUser } from '../setup/factories'
import { loginWithPassword } from '@/server/auth/session'
import { APP_COOKIE } from '@/server/auth/guards'

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

import { salvarPetDoQuiz } from '@/app/app/[slug]/boas-vindas/actions'

async function montar(o: { servesCats?: boolean } = {}) {
  const b = await makeBusiness({ niche: 'PET' })
  if (o.servesCats) await prisma.businessSettings.update({ where: { businessId: b.id }, data: { nicheOptions: { servesCats: true } } })
  const cliente = await makeCustomer(b.id)
  await entrarComoCliente(jar, b.id, cliente.id)
  return { b, slug: b.slug, cliente }
}

beforeEach(async () => {
  jar.clear()
  await resetDb()
})

describe('salvarPetDoQuiz', () => {
  test('cria o pet do próprio cliente e devolve /a/agendar?pet=<id>', async () => {
    const c = await montar()
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Thor', species: 'DOG', size: 'MEDIUM', breed: 'Poodle', birthMonth: '2023-11', coat: 'LONG', careNotes: 'Medo de secador', then: 'agendar', volta: '' }))
    const pet = await prisma.pet.findFirstOrThrow({ where: { businessId: c.b.id } })
    expect(r).toEqual({ ok: true, petId: pet.id, next: `/${c.slug}/agendar?pet=${pet.id}` })
    expect(pet).toMatchObject({ customerId: c.cliente.id, name: 'Thor', size: 'MEDIUM', breed: 'Poodle', coat: 'LONG', careNotes: 'Medo de secador' })
  })

  test('a volta sobrevive ao "outro pet" e o pet novo entra na volta do Agendar', async () => {
    const c = await montar()
    const volta = `/${c.slug}/agendar?servicos=x`
    const outro = await salvarPetDoQuiz(c.slug, form({ name: 'Thor', species: 'DOG', size: 'SMALL', then: 'outro', volta }))
    expect(outro).toMatchObject({ ok: true, next: `/${c.slug}/boas-vindas?novo=1&volta=${encodeURIComponent(volta)}` })
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Mel', species: 'DOG', size: 'SMALL', then: 'agendar', volta: `${volta}&pet=velho` }))
    const mel = await prisma.pet.findFirstOrThrow({ where: { businessId: c.b.id, name: 'Mel' } })
    expect(r).toMatchObject({ ok: true, next: `/${c.slug}/agendar?servicos=x&pet=${mel.id}` })
  })

  test('com volta=/a/agendar?servicos=x devolve a volta; volta de fora é ignorada', async () => {
    const c = await montar()
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Thor', species: 'DOG', size: 'SMALL', then: 'agendar', volta: `/${c.slug}/agendar?servicos=x` }))
    expect(r).toMatchObject({ ok: true, next: expect.stringMatching(new RegExp(`^/${c.slug}/agendar\\?servicos=x&pet=`)) })
    const fora = await salvarPetDoQuiz(c.slug, form({ name: 'Mel', species: 'DOG', size: 'SMALL', then: 'agendar', volta: 'https://evil.example/agendar' }))
    expect(fora).toMatchObject({ ok: true, next: expect.stringMatching(new RegExp(`^/${c.slug}/agendar\\?pet=`)) })
    const outraPagina = await salvarPetDoQuiz(c.slug, form({ name: 'Bidu', species: 'DOG', size: 'SMALL', then: 'agendar', volta: `/${c.slug}/premios` }))
    expect(outraPagina).toMatchObject({ ok: true, next: expect.stringMatching(/agendar\?pet=/) })
  })

  test('"outro" devolve /a/boas-vindas?novo=1', async () => {
    const c = await montar()
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Thor', species: 'DOG', size: 'MEDIUM', then: 'outro' }))
    expect(r).toMatchObject({ ok: true, next: `/${c.slug}/boas-vindas?novo=1` })
  })

  test('cão sem porte: fields.size', async () => {
    const c = await montar()
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Thor', species: 'DOG', size: '', then: 'agendar' }))
    expect(r).toMatchObject({ ok: false, fields: { size: 'Escolha o porte.' } })
    expect(await prisma.pet.count()).toBe(0)
  })

  test('gato com gatos desligados: fields.species', async () => {
    const c = await montar()
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Mel', species: 'CAT', size: '', then: 'agendar' }))
    expect(r).toMatchObject({ ok: false, fields: { species: 'A loja não atende gatos no momento.' } })
    expect(await prisma.pet.count()).toBe(0)
  })

  test('gato com gatos ligados é criado sem porte', async () => {
    const c = await montar({ servesCats: true })
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Mel', species: 'CAT', size: '', then: 'agendar' }))
    expect(r.ok).toBe(true)
    expect(await prisma.pet.findFirstOrThrow()).toMatchObject({ species: 'CAT', size: null })
  })

  test('customerId forjado no formulário é ignorado', async () => {
    const c = await montar()
    const outro = await makeCustomer(c.b.id)
    const r = await salvarPetDoQuiz(c.slug, form({ customerId: outro.id, name: 'Thor', species: 'DOG', size: 'MEDIUM', then: 'agendar' }))
    expect(r.ok).toBe(true)
    expect((await prisma.pet.findFirstOrThrow()).customerId).toBe(c.cliente.id)
    expect(await prisma.pet.count({ where: { customerId: outro.id } })).toBe(0)
  })

  test('21º pet ativo: mensagem de limite e nada grava', async () => {
    const c = await montar()
    for (let i = 0; i < 20; i++) await makePet(c.b.id, c.cliente.id, { name: `Pet ${i}` })
    const r = await salvarPetDoQuiz(c.slug, form({ name: 'Extra', species: 'DOG', size: 'MEDIUM', then: 'agendar' }))
    expect(r).toMatchObject({ ok: false, message: 'Você já tem 20 pets ativos. Arquive algum antes.' })
    expect(await prisma.pet.count()).toBe(20)
  })

  test('visitante: redirect para a loja', async () => {
    const c = await montar()
    jar.clear()
    const u = await makeUser({ password: 'senha-bem-longa' })
    jar.set(APP_COOKIE, (await loginWithPassword({ email: u.email, password: 'senha-bem-longa' }, new Date())).token)
    await expect(salvarPetDoQuiz(c.slug, form({ name: 'Thor', species: 'DOG', size: 'MEDIUM' }))).rejects.toMatchObject({ to: expect.stringContaining(`/${c.slug}?volta=`) })
    expect(await prisma.pet.count()).toBe(0)
  })

  test('loja de outro cliente: o cliente de A em B é visitante e nada grava em A nem em B', async () => {
    const a = await montar()
    const b = await makeBusiness({ niche: 'PET' })
    await expect(salvarPetDoQuiz(b.slug, form({ name: 'Thor', species: 'DOG', size: 'MEDIUM' }))).rejects.toMatchObject({ to: expect.stringContaining(`/${b.slug}`) })
    expect(await prisma.pet.count()).toBe(0)
    void a
  })
})
