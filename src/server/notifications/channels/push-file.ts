import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PushChannel } from './types'

/** Pasta dos push de desenvolvimento (fica dentro de `.local`, que o Git ignora). */
export const PUSH_DIR = '.local/push'

/** Canal de desenvolvimento: grava cada push como um JSON na pasta (criada se não existir). */
export function createPushFileChannel(dir: string): PushChannel {
  return {
    async send(msg) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.json`), JSON.stringify(msg, null, 2), 'utf8')
      return { invalidTokens: [] }
    },
  }
}
