import { DomainError } from '@/server/domain/errors'

/** Espera a rejeição da promessa e devolve o `DomainError`; falha se não houver erro ou se for de outro tipo. */
export async function domainError(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError)
    return e as DomainError
  }
  throw new Error('Era esperado um erro, mas a chamada terminou sem erro.')
}
