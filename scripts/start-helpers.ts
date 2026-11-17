import { classifyConnectionError, CATEGORY_LABEL } from '../src/server/db/self-check'

export type WaitOptions = { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> }

const dormir = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))

/** Tenta `connect` até funcionar. A mensagem final não repete a do driver, que pode trazer a URL com a senha. */
export async function waitForDatabase(connect: () => Promise<void>, { attempts, delayMs, sleep = dormir }: WaitOptions): Promise<void> {
  let motivo = CATEGORY_LABEL.other
  for (let i = 1; i <= attempts; i++) {
    try {
      await connect()
      return
    } catch (erro) {
      motivo = CATEGORY_LABEL[classifyConnectionError(erro)]
      if (i < attempts) await sleep(delayMs)
    }
  }
  throw new Error(`O banco não aceitou conexão depois de ${attempts} tentativas (último erro: ${motivo}). Confira se ele está no ar e se DATABASE_URL está certa.`)
}

/** A migração na partida liga por padrão; `MIGRATE_ON_START=false` desliga. */
export function shouldMigrate(env: Record<string, string | undefined>): boolean {
  return env['MIGRATE_ON_START'] !== 'false'
}
