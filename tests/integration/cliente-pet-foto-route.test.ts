import { beforeEach, describe, expect, test, vi } from 'vitest'
import { prisma } from '@/server/db/client'
import { entrarComoCliente } from '../setup/cliente'
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

import { POST } from '@/app/app/[slug]/pets/[petId]/foto/route'

const OK = { host: 'app.localhost:3000', origin: 'http://app.localhost:3000' }
// PNG 1x1 válido
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

function pedido(slug: string, petId: string, campos: Record<string, string | File>, extra: Record<string, string> = {}, headers: Record<string, string> = OK) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return [
    new Request(`http://app.localhost:3000/${slug}/pets/${petId}/foto`, { method: 'POST', headers: { ...headers, ...extra }, body: fd }),
    { params: Promise.resolve({ slug, petId }) },
  ] as const
}

async function montar() {
  const b = await makeBusiness({ niche: 'PET' })
  const cliente = await makeCustomer(b.id)
  await entrarComoCliente(jar, b.id, cliente.id)
  const pet = await makePet(b.id, cliente.id, { name: 'Thor' })
  return { b, slug: b.slug, cliente, pet }
}

beforeEach(async () => {
  jar.clear()
  await resetDb()
})

describe('rota de foto do pet do cliente', () => {
  test('só aceita POST', async () => {
    const rota = await import('@/app/app/[slug]/pets/[petId]/foto/route')
    expect(Object.keys(rota)).toEqual(['POST'])
  })

  test('foto válida grava e responde ok (JSON e formulário)', async () => {
    const c = await montar()
    const json = await POST(...pedido(c.slug, c.pet.id, { foto: new File([PNG], 'f.png', { type: 'image/png' }) }, { accept: 'application/json' }))
    expect(json.status).toBe(200)
    expect(await json.json()).toEqual({ ok: true, code: 'ok' })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).photoUploadId).not.toBeNull()
    const html = await POST(...pedido(c.slug, c.pet.id, { foto: new File([PNG], 'f.png', { type: 'image/png' }), destino: `/${c.slug}/pets/${c.pet.id}` }))
    expect(html.status).toBe(303)
    expect(html.headers.get('location')).toBe(`/${c.slug}/pets/${c.pet.id}?foto=ok`)
  })

  test('remover tira a foto', async () => {
    const c = await montar()
    await POST(...pedido(c.slug, c.pet.id, { foto: new File([PNG], 'f.png', { type: 'image/png' }) }, { accept: 'application/json' }))
    const r = await POST(...pedido(c.slug, c.pet.id, { intent: 'remove' }, { accept: 'application/json' }))
    expect(await r.json()).toEqual({ ok: true, code: 'ok' })
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: c.pet.id } })).photoUploadId).toBeNull()
  })

  test('pet de outro cliente → not_found e nada gravado', async () => {
    const c = await montar()
    const outro = await makeCustomer(c.b.id)
    const alheio = await makePet(c.b.id, outro.id, { name: 'Alheio' })
    const r = await POST(...pedido(c.slug, alheio.id, { foto: new File([PNG], 'f.png', { type: 'image/png' }) }, { accept: 'application/json' }))
    expect(await r.json()).toEqual({ ok: false, code: 'not_found' })
    expect(await prisma.upload.count()).toBe(0)
    expect((await prisma.pet.findUniqueOrThrow({ where: { id: alheio.id } })).photoUploadId).toBeNull()
  })

  test('origem de fora → 403 e sem sessão de cliente → 303 para entrar', async () => {
    const c = await montar()
    const fora = await POST(...pedido(c.slug, c.pet.id, {}, {}, { host: OK.host, origin: 'http://evil.example' }))
    expect(fora.status).toBe(403)
    jar.clear()
    const anonimo = await POST(...pedido(c.slug, c.pet.id, { foto: new File([PNG], 'f.png', { type: 'image/png' }) }))
    expect(anonimo.status).toBe(303)
    expect(anonimo.headers.get('location')).toBe(`/${c.slug}/entrar`)
    expect(await prisma.upload.count()).toBe(0)
  })

  test('arquivo grande → too_large e sem arquivo → no_file', async () => {
    const c = await montar()
    const grande = new File([new Uint8Array(8 * 1024 * 1024 + 10)], 'g.png', { type: 'image/png' })
    const r = await POST(...pedido(c.slug, c.pet.id, { foto: grande }, { accept: 'application/json' }))
    expect(await r.json()).toEqual({ ok: false, code: 'too_large' })
    const sem = await POST(...pedido(c.slug, c.pet.id, {}, { accept: 'application/json' }))
    expect(await sem.json()).toEqual({ ok: false, code: 'no_file' })
    expect(await prisma.upload.count()).toBe(0)
  })

  test('destino de fora da loja é ignorado', async () => {
    const c = await montar()
    const r = await POST(...pedido(c.slug, c.pet.id, { intent: 'remove', destino: 'https://evil.example/x' }))
    expect(r.headers.get('location')).toBe(`/${c.slug}/pets/${c.pet.id}?foto=ok`)
  })
})
