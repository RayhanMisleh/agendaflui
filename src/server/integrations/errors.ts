/**
 * Falha de um serviço externo (ViaCEP, Frenet, Mercado Pago). `code` diz o tipo; a mensagem é nossa, sem texto da resposta
 * do serviço, CEP, token nem dado do cliente.
 */
export type IntegrationErrorCode = 'timeout' | 'unavailable' | 'rejected' | 'invalid_response' | 'revoked' | 'rate_limited'

export class IntegrationError extends Error {
  constructor(
    public code: IntegrationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'IntegrationError'
  }
}
