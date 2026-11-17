import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { checkStorageDir } from '@/server/storage/check'

let base: string
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'agendaflui-check-'))
})
afterAll(async () => {
  await chmod(join(base, 'somente-leitura'), 0o755).catch(() => undefined)
  await rm(base, { recursive: true, force: true })
})

describe('checkStorageDir', () => {
  test('pasta existente e gravável passa e não deixa rastro', async () => {
    await expect(checkStorageDir(base)).resolves.toBeUndefined()
    expect((await readdir(base)).filter((n) => n.includes('check'))).toEqual([])
  })

  test('pasta inexistente é recusada com mensagem que nomeia STORAGE_DIR', async () => {
    await expect(checkStorageDir(join(base, 'nao-existe'))).rejects.toThrow(/STORAGE_DIR.*não existe/)
  })

  test('arquivo no lugar da pasta é recusado', async () => {
    const arquivo = join(base, 'arquivo.txt')
    await writeFile(arquivo, 'x')
    await expect(checkStorageDir(arquivo)).rejects.toThrow(/STORAGE_DIR.*não é uma pasta/)
  })

  test.skipIf(process.getuid?.() === 0)('pasta sem permissão de escrita é recusada', async () => {
    const dir = join(base, 'somente-leitura')
    await import('node:fs/promises').then((fs) => fs.mkdir(dir))
    await chmod(dir, 0o555)
    await expect(checkStorageDir(dir)).rejects.toThrow(/STORAGE_DIR.*gravar/)
  })
})
