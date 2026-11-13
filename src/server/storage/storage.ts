import { env } from '@/server/env'
import { createLocalDiskStorage } from './local-disk'

export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>
  delete(key: string): Promise<void>
}

let padrao: Storage | undefined

/** Armazenamento em disco apontando para `STORAGE_DIR`. */
export function getStorage(): Storage {
  padrao ??= createLocalDiskStorage(env.STORAGE_DIR)
  return padrao
}
