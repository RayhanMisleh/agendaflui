import { DomainError } from '@/server/domain/errors'

export const MENSAGEM_CONFLITO = 'Alguém mudou estas configurações agora. Recarregue para ver.'

/** Versão antiga vira a frase da tela (o domínio fala em "refazer a alteração"); o digitado volta no estado. */
export function comConflito(err: unknown): unknown {
  if (err instanceof DomainError && err.reason === 'stale_version') {
    return new DomainError('conflict', MENSAGEM_CONFLITO, { reason: 'stale_version' })
  }
  return err
}
