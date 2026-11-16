import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import sharp from 'sharp'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Business } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { saveImage, uploadUrl } from '@/server/storage/images'
import { createLocalDiskStorage } from '@/server/storage/local-disk'
import type { Storage } from '@/server/storage/storage'
import { resetDb } from '../setup/db'
import { makeBusiness } from '../setup/factories'

let dir: string
let storage: Storage
let biz: Business
const createdBy = { type: 'SYSTEM', id: null } as const

vi.mock('@/server/storage/storage', async (original) => {
  const real = await original<typeof import('@/server/storage/storage')>()
  return { ...real, getStorage: () => storage }
})

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#0e4f5c' } }).png().toBuffer()

async function arquivosNoDisco(): Promise<string[]> {
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true })
  return entradas.filter((e) => e.isFile()).map((e) => e.name)
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agendaflui-storage-'))
  storage = createLocalDiskStorage(dir)
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  await resetDb()
  await rm(dir, { recursive: true, force: true })
  await import('node:fs/promises').then((fs) => fs.mkdir(dir, { recursive: true }))
  biz = await makeBusiness()
})

describe('saveImage', () => {
  test('grava logo como webp dentro do limite', async () => {
    const up = await saveImage({ businessId: biz.id, data: await png(2400, 1200), purpose: 'logo', createdBy }, storage)
    expect(up.mimeType).toBe('image/webp')
    expect(up.width).toBe(1200)
    expect(up.height).toBe(600)
    expect(up.path.startsWith(`${biz.id}/`)).toBe(true)
    expect(await storage.get(up.path)).not.toBeNull()
    expect(uploadUrl(up)).toBe(`/arquivos/${up.path}`)
    expect(uploadUrl(null)).toBeNull()
  })
  test('não amplia imagem pequena', async () => {
    const up = await saveImage({ businessId: biz.id, data: await png(100, 50), purpose: 'logo', createdBy }, storage)
    expect([up.width, up.height]).toEqual([100, 50])
  })
  test('símbolo vira quadrado', async () => {
    const up = await saveImage({ businessId: biz.id, data: await png(900, 600), purpose: 'symbol', createdBy }, storage)
    expect([up.width, up.height]).toEqual([512, 512])
  })
  test('favicon sai PNG 64x64', async () => {
    const up = await saveImage({ businessId: biz.id, data: await png(300, 200), purpose: 'favicon', createdBy }, storage)
    expect(up.mimeType).toBe('image/png')
    expect(up.path.endsWith('.png')).toBe(true)
    expect([up.width, up.height]).toEqual([64, 64])
    const salvo = await storage.get(up.path)
    expect(salvo?.contentType).toBe('image/png')
    expect((await sharp(salvo!.data).metadata()).format).toBe('png')
  })
  test('aplica a orientação EXIF', async () => {
    const jpeg = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ff0000' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const up = await saveImage({ businessId: biz.id, data: jpeg, purpose: 'generic', createdBy }, storage)
    expect([up.width, up.height]).toEqual([100, 200])
  })
  test('remove metadados EXIF do arquivo final', async () => {
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#00ff00' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'segredo-do-autor' } })
      .toBuffer()
    expect(jpeg.includes('segredo-do-autor')).toBe(true)
    const up = await saveImage({ businessId: biz.id, data: jpeg, purpose: 'generic', createdBy }, storage)
    const salvo = (await storage.get(up.path))!.data
    expect(salvo.includes('segredo-do-autor')).toBe(false)
    const meta = await sharp(salvo).metadata()
    expect(meta.exif).toBeUndefined()
  })
  test('WebP animado grava só o primeiro quadro', async () => {
    const quadro = (cor: string) =>
      sharp({ create: { width: 40, height: 30, channels: 3, background: cor } }).png().toBuffer()
    const animado = await sharp([await quadro('#ff0000'), await quadro('#0000ff')], { join: { animated: true } })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer()
    expect((await sharp(animado, { animated: true }).metadata()).pages).toBe(2)
    const up = await saveImage({ businessId: biz.id, data: animado, purpose: 'generic', createdBy }, storage)
    expect([up.width, up.height]).toEqual([40, 30])
    const meta = await sharp((await storage.get(up.path))!.data, { animated: true }).metadata()
    expect(meta.pages ?? 1).toBe(1)
  })
  test('texto disfarçado de imagem é recusado e nada é gravado', async () => {
    await expect(
      saveImage({ businessId: biz.id, data: Buffer.from('não sou imagem'), purpose: 'logo', createdBy }, storage),
    ).rejects.toMatchObject({ code: 'not_an_image' })
    expect(await prisma.upload.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })
  test('SVG é recusado', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    await expect(saveImage({ businessId: biz.id, data: svg, purpose: 'logo', createdBy }, storage)).rejects.toMatchObject({
      code: 'unsupported_format',
    })
    expect(await prisma.upload.count()).toBe(0)
    expect(await arquivosNoDisco()).toEqual([])
  })
  test('GIF é recusado', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).gif().toBuffer()
    await expect(saveImage({ businessId: biz.id, data: gif, purpose: 'logo', createdBy }, storage)).rejects.toMatchObject({
      code: 'unsupported_format',
    })
  })
  test('arquivo acima de 8 MB é recusado', async () => {
    await expect(
      saveImage({ businessId: biz.id, data: Buffer.alloc(8 * 1024 * 1024 + 1), purpose: 'logo', createdBy }, storage),
    ).rejects.toMatchObject({ code: 'too_large' })
    expect(await arquivosNoDisco()).toEqual([])
  })
  test('imagem acima de 40 megapixels é recusada (só cabeçalho PNG)', async () => {
    // PNG de 7000x6000 (42 MP) com IHDR válido e um único IDAT minúsculo: nenhum pixel é alocado.
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
    const cabecalho = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      bloco('IHDR', ihdr),
      bloco('IDAT', deflateSync(Buffer.alloc(10))),
      bloco('IEND', Buffer.alloc(0)),
    ])
    await expect(
      saveImage({ businessId: biz.id, data: cabecalho, purpose: 'logo', createdBy }, storage),
    ).rejects.toMatchObject({ code: 'too_many_pixels' })
    expect(await prisma.upload.count()).toBe(0)
  })
  test('upload da plataforma usa a pasta platform', async () => {
    const up = await saveImage({ businessId: null, data: await png(64, 64), purpose: 'generic', createdBy }, storage)
    expect(up.path.startsWith('platform/')).toBe(true)
    expect(up.businessId).toBeNull()
  })
  test('falha ao gravar o registro não deixa arquivo órfão', async () => {
    // Conta inexistente: o banco recusa a FK depois que o arquivo já foi gravado.
    const inexistente = '00000000-0000-4000-8000-000000000000'
    await expect(
      saveImage({ businessId: inexistente, data: await png(64, 64), purpose: 'generic', createdBy }, storage),
    ).rejects.toThrow()
    expect(await arquivosNoDisco()).toEqual([])
    expect(await prisma.upload.count()).toBe(0)
  })
})

describe('createLocalDiskStorage', () => {
  test('chave com .. é recusada pelo disco', async () => {
    await expect(storage.get('../../etc/passwd')).rejects.toThrow()
    await expect(storage.put('a/../../x', Buffer.from('x'), 'text/plain')).rejects.toThrow()
  })
  test('recusa barra inicial, barra invertida, byte nulo e chave vazia', async () => {
    for (const chave of ['/abs', 'a\\b', 'a\0b', '', 'a//b']) {
      await expect(storage.get(chave)).rejects.toThrow()
      await expect(storage.put(chave, Buffer.from('x'), 'text/plain')).rejects.toThrow()
      await expect(storage.delete(chave)).rejects.toThrow()
    }
  })
  test('put cria diretórios, get devolve conteúdo e tipo, delete apaga', async () => {
    await storage.put('x/y/z.txt', Buffer.from('oi'), 'text/plain')
    const lido = await storage.get('x/y/z.txt')
    expect(lido?.data.toString()).toBe('oi')
    expect(lido?.contentType).toBe('text/plain')
    await storage.delete('x/y/z.txt')
    expect(await storage.get('x/y/z.txt')).toBeNull()
  })
  test('get e delete de chave inexistente não lançam', async () => {
    expect(await storage.get('nao/existe.webp')).toBeNull()
    await expect(storage.delete('nao/existe.webp')).resolves.toBeUndefined()
  })
})

describe('GET /arquivos/[...key]', () => {
  const chamar = async (metodo: 'GET' | 'HEAD', key: string[]) => {
    const rota = await import('@/app/arquivos/[...key]/route')
    return rota[metodo](new Request('http://painel.localhost/arquivos/' + key.join('/')), {
      params: Promise.resolve({ key }),
    })
  }

  test('serve o arquivo com os cabeçalhos certos', async () => {
    const up = await saveImage({ businessId: biz.id, data: await png(64, 64), purpose: 'logo', createdBy }, storage)
    const res = await chamar('GET', up.path.split('/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const corpo = Buffer.from(await res.arrayBuffer())
    expect((await sharp(corpo).metadata()).format).toBe('webp')
  })
  test('HEAD não devolve corpo', async () => {
    const up = await saveImage({ businessId: biz.id, data: await png(64, 64), purpose: 'logo', createdBy }, storage)
    const res = await chamar('HEAD', up.path.split('/'))
    expect(res.status).toBe(200)
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })
  test('404 para inexistente e para chaves malformadas', async () => {
    for (const key of [[biz.id, 'nao-existe.webp'], ['..', 'etc', 'passwd'], [biz.id, '%2e%2e', 'x'], ['a', '%2e%2e%2fb'], [biz.id, 'a.meta'], ['%E0%A4%A']]) {
      const res = await chamar('GET', key)
      expect(res.status, key.join('/')).toBe(404)
    }
  })
})
