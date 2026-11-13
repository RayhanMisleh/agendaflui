import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { createLocalDiskStorage } from '@/server/storage/local-disk'
import type { Storage } from '@/server/storage/storage'

let dir: string
let storage: Storage
vi.mock('@/server/storage/storage', () => ({ getStorage: () => storage }))

const { GET, HEAD } = await import('@/app/arquivos/[...key]/route')
const chamar = (fn: typeof GET, chave: string) =>
  fn(new Request(`http://localhost/arquivos/${chave}`), { params: Promise.resolve({ key: chave.split('/') }) })

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-arquivos-'))
  storage = createLocalDiskStorage(dir)
  await storage.put('c1/logo.webp', Buffer.from('webp'), 'image/webp')
  await storage.put('c1/icone.png', Buffer.from('png'), 'image/png')
  await storage.put('c1/foto.jpg', Buffer.from('jpg'), 'image/jpeg')
  await storage.put('c1/pagina.html', Buffer.from('<script>alert(1)</script>'), 'text/html')
  await storage.put('c1/desenho.svg', Buffer.from('<svg/>'), 'image/svg+xml')
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('/arquivos', () => {
  test.each(['c1/logo.webp', 'c1/icone.png', 'c1/foto.jpg'])('imagem %s sai com tipo, nosniff e CSP restritiva', async (chave) => {
    const r = await chamar(GET, chave)
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(r.headers.get('Content-Type')).toMatch(/^image\/(webp|png|jpeg)$/)
    expect(r.headers.get('Cache-Control')).toContain('immutable')
  })
  test('HEAD também leva a CSP e não leva corpo', async () => {
    const r = await chamar(HEAD, 'c1/logo.webp')
    expect(r.status).toBe(200)
    expect(r.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(await r.text()).toBe('')
  })
  test('arquivo gravado com text/html ou svg devolve 404 sem o conteúdo', async () => {
    for (const chave of ['c1/pagina.html', 'c1/desenho.svg']) {
      for (const fn of [GET, HEAD]) {
        const r = await chamar(fn, chave)
        expect(r.status, chave).toBe(404)
        expect(await r.text()).not.toContain('script')
      }
    }
  })
  test('arquivo inexistente devolve 404', async () => {
    expect((await chamar(GET, 'c1/nao-existe.png')).status).toBe(404)
  })
})
