import { randomUUID } from 'node:crypto'
import { rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Recusa na partida uma pasta de armazenamento que não existe ou onde o processo não grava. Nunca cria a pasta. */
export async function checkStorageDir(dir: string): Promise<void> {
  const info = await stat(dir).catch(() => null)
  if (!info) {
    throw new Error(`STORAGE_DIR não existe (${dir}). Crie a pasta e monte o volume persistente nela antes de iniciar.`)
  }
  if (!info.isDirectory()) throw new Error(`STORAGE_DIR não é uma pasta (${dir}).`)
  const prova = join(dir, `.check-${randomUUID()}.tmp`)
  try {
    await writeFile(prova, '')
  } catch {
    throw new Error(`STORAGE_DIR existe mas o processo não consegue gravar nele (${dir}). Ajuste o dono ou as permissões da pasta.`)
  } finally {
    await rm(prova, { force: true }).catch(() => undefined)
  }
}
