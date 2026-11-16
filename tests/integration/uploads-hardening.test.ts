import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { saveImage } from '@/server/storage/images'
import { createLocalDiskStorage } from '@/server/storage/local-disk'
import type { Storage } from '@/server/storage/storage'
import { resetDb } from '../setup/db'
import { makeBusiness } from '../setup/factories'

let dir: string
let fora: string
let storage: Storage

vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => storage }
})

// A mensagem de erro do `sharp` muda de versão para versão (e de idioma, se alguém o trocar): a detecção de
// "imagem grande demais" não pode depender dela. Aqui toda falha de leitura com limite de pixels sai com outro texto.
vi.mock('sharp', async (original) => {
  const real = (await original<typeof import('sharp')>()).default
  const embrulhado = ((entrada: Parameters<typeof real>[0], opcoes?: Parameters<typeof real>[1]) => {
    const instancia = real(entrada, opcoes)
    const lerMetadados = instancia.metadata.bind(instancia)
    instancia.metadata = (async () => {
      try {
        return await lerMetadados()
      } catch {
        throw new Error('Falha ao ler a imagem (texto sem relação com o limite)')
      }
    }) as typeof instancia.metadata
    return instancia
  }) as typeof real
  Object.assign(embrulhado, real)
  return { default: embrulhado }
})

const { GET } = await import('@/app/arquivos/[...key]/route')
const chamar = (...key: string[]) =>
  GET(new Request(`http://localhost/arquivos/${key.join('/')}`), { params: Promise.resolve({ key }) })

async function nomes(): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true })
  return entradas.filter((e) => !e.isDirectory()).map((e) => e.name)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-hard-'))
  fora = await mkdtemp(join(tmpdir(), 'agendaflui-hard-fora-'))
  storage = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await rm(fora, { recursive: true, force: true })
})
beforeEach(async () => {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
})

describe('gravação em disco que falha no meio', () => {
  test('conteúdo inválido: não sobra .meta nem .tmp', async () => {
    await expect(storage.put('c1/a.webp', undefined as never, 'image/webp')).rejects.toThrow()
    expect(await nomes()).toEqual([])
  })

  test('falha ao renomear (já existe uma pasta com esse nome): não sobra .meta nem .tmp', async () => {
    await mkdir(join(dir, 'c1', 'a.webp'), { recursive: true })
    await expect(storage.put('c1/a.webp', Buffer.from('x'), 'image/webp')).rejects.toThrow()
    expect(await nomes()).toEqual([])
  })

  test('regravar uma chave que já existe e falhar não apaga o tipo do arquivo antigo', async () => {
    await storage.put('c1/b.webp', Buffer.from('antigo'), 'image/webp')
    await expect(storage.put('c1/b.webp', undefined as never, 'image/png')).rejects.toThrow()
    const atual = await storage.get('c1/b.webp')
    expect(atual?.data.toString()).toBe('antigo')
    expect(atual?.contentType).toBe('image/webp')
    expect((await nomes()).sort()).toEqual(['b.webp', 'b.webp.meta'])
  })
})

describe('/arquivos: um segmento é decodificado uma vez só (pelo Next)', () => {
  beforeEach(async () => {
    await storage.put('c1/sub/logo.webp', Buffer.from('webp'), 'image/webp')
    await storage.put('c1/logo.webp', Buffer.from('webp'), 'image/webp')
    await storage.put('c1/a%25b.webp', Buffer.from('webp'), 'image/webp')
  })

  test('%2f que chega no segmento não vira barra', async () => {
    // URL `/arquivos/c1/sub%252flogo.webp`: o Next entrega `sub%2flogo.webp`.
    expect((await chamar('c1', 'sub%2flogo.webp')).status).toBe(404)
  })

  test('%252e%252e (ponto ponto codificado duas vezes) não sobe de pasta', async () => {
    expect((await chamar('c1', 'sub', '%2e%2e', 'logo.webp')).status).toBe(404)
    expect((await chamar('c1', '%2e%2e', 'c1', 'logo.webp')).status).toBe(404)
  })

  test('nome com % literal é servido como está', async () => {
    expect((await chamar('c1', 'a%25b.webp')).status).toBe(200)
  })

  test('segmento ".." de verdade também é recusado', async () => {
    expect((await chamar('c1', '..', 'c1', 'logo.webp')).status).toBe(404)
  })

  test('arquivo normal continua saindo', async () => {
    expect((await chamar('c1', 'logo.webp')).status).toBe(200)
  })
})

describe('link simbólico', () => {
  beforeEach(async () => {
    await storage.put('c1/logo.webp', Buffer.from('webp'), 'image/webp')
    await writeFile(join(fora, 'segredo.webp'), 'conteudo-de-fora')
    await writeFile(join(dir, 'c1', 'fuga.webp.meta'), JSON.stringify({ contentType: 'image/webp' }))
    await symlink(join(fora, 'segredo.webp'), join(dir, 'c1', 'fuga.webp'))
    await writeFile(join(dir, 'c1', 'atalho.webp.meta'), JSON.stringify({ contentType: 'image/webp' }))
    await symlink(join(dir, 'c1', 'logo.webp'), join(dir, 'c1', 'atalho.webp'))
    await symlink(fora, join(dir, 'pasta-fora'))
    await writeFile(join(fora, 'x.webp'), 'conteudo-de-fora')
    await writeFile(join(fora, 'x.webp.meta'), JSON.stringify({ contentType: 'image/webp' }))
  })

  test('arquivo que é link para fora da pasta devolve 404', async () => {
    const r = await chamar('c1', 'fuga.webp')
    expect(r.status).toBe(404)
    expect(await r.text()).not.toContain('conteudo-de-fora')
  })

  test('link para outro arquivo da própria pasta também devolve 404', async () => {
    expect((await chamar('c1', 'atalho.webp')).status).toBe(404)
  })

  test('pasta que é link para fora devolve 404', async () => {
    const r = await chamar('pasta-fora', 'x.webp')
    expect(r.status).toBe(404)
    expect(await r.text()).not.toContain('conteudo-de-fora')
  })

  test('o armazenamento trata link como ausente', async () => {
    expect(await storage.get('c1/fuga.webp')).toBeNull()
    expect(await storage.get('c1/atalho.webp')).toBeNull()
    expect(await storage.get('pasta-fora/x.webp')).toBeNull()
    expect(await storage.get('c1/logo.webp')).not.toBeNull()
  })
})

describe('imagem grande demais não depende do texto do erro do sharp', () => {
  beforeEach(resetDb)

  test('PNG de 42 megapixels só com cabeçalho: too_many_pixels', async () => {
    const bloco = (tipo: string, dados: Buffer) => {
      const tam = Buffer.alloc(4)
      tam.writeUInt32BE(dados.length)
      const corpo = Buffer.concat([Buffer.from(tipo), dados])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(crc32(corpo))
      return Buffer.concat([tam, corpo, crc])
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(7000, 0)
    ihdr.writeUInt32BE(6000, 4)
    ihdr.set([8, 2, 0, 0, 0], 8)
    const grande = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      bloco('IHDR', ihdr),
      bloco('IDAT', deflateSync(Buffer.alloc(10))),
      bloco('IEND', Buffer.alloc(0)),
    ])
    const b = await makeBusiness()
    await expect(
      saveImage({ businessId: b.id, data: grande, purpose: 'logo', createdBy: { type: 'SYSTEM', id: null } }, storage),
    ).rejects.toMatchObject({ code: 'too_many_pixels' })
  })

  test('texto continua sendo not_an_image e imagem normal passa', async () => {
    const b = await makeBusiness()
    const por = { type: 'SYSTEM', id: null } as const
    await expect(
      saveImage({ businessId: b.id, data: Buffer.from('texto'), purpose: 'logo', createdBy: por }, storage),
    ).rejects.toMatchObject({ code: 'not_an_image' })
    const ok = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).png().toBuffer()
    expect((await saveImage({ businessId: b.id, data: ok, purpose: 'logo', createdBy: por }, storage)).width).toBe(20)
  })
})
