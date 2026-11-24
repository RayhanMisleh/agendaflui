/** Estado de todos os formulários de Minha conta: o que a ação devolveu e o que a pessoa digitou (nunca senha nem código). */
export type EstadoConta = {
  ok: boolean
  message: string | null
  fields: Record<string, string>
  values: Record<string, string>
  /** A ação foi recusada porque a pessoa precisa criar uma senha antes (regras 7 e 9). */
  needsPassword: boolean
  /** Só na troca de e-mail: em que passo o formulário está e quantos códigos já foram pedidos. */
  step: 'email' | 'codigo'
  sent: number
}

export const ESTADO_CONTA: EstadoConta = { ok: false, message: null, fields: {}, values: {}, needsPassword: false, step: 'email', sent: 0 }
