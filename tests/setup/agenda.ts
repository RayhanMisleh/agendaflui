import { DomainError } from '@/server/domain/errors'

/**
 * Faz o que a tela faz com um conflito da equipe: chama sem impressão; se o servidor pedir confirmação, chama de novo com a
 * impressão que ele devolveu.
 */
export async function confirmando<T>(run: (acknowledged?: string) => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    if (e instanceof DomainError && e.reason === 'needs_confirmation') {
      const ack = e.details?.['acknowledgement']
      if (typeof ack === 'string') return run(ack)
    }
    throw e
  }
}
