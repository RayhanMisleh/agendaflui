import { isLocalDate, localDayRange } from '@/server/time'
import { PLATFORM_TIME_ZONE } from '../_lib/format'
import { um } from '@/app/_lib/params'

export const TIPOS_DE_ATOR = [
  { value: 'PLATFORM_ADMIN', label: 'Admin da plataforma' },
  { value: 'USER', label: 'Membro da conta' },
  { value: 'SYSTEM', label: 'Sistema' },
] as const

export type FiltrosAuditoria = {
  query: { businessId?: string; action?: string; actorType?: string; from?: Date; to?: Date; cursor?: string }
  /** O que volta aos campos do formulário. */
  values: { conta: string; acao: string; ator: string; de: string; ate: string }
  erro: string | null
}

/**
 * Lê os filtros da auditoria da URL. As datas são dias inteiros no fuso da plataforma (o dia final entra por inteiro).
 * Valor inválido nunca vira erro de servidor: o filtro é ignorado e `erro` diz o que corrigir. Período máximo e padrão
 * ficam por conta do domínio.
 */
export function lerFiltros(q: Record<string, string | string[] | undefined>): FiltrosAuditoria {
  const conta = um(q.conta).trim()
  const acao = um(q.acao).trim().slice(0, 100)
  const atorBruto = um(q.ator)
  const ator = TIPOS_DE_ATOR.find((t) => t.value === atorBruto)?.value ?? ''
  const atorInvalido = atorBruto !== '' && ator === ''
  const de = um(q.de).trim()
  const ate = um(q.ate).trim()
  const cursor = um(q.cursor)
  const query: FiltrosAuditoria['query'] = {}
  let erro: string | null = null
  // A conta (identificador ou id) é resolvida pela página no servidor; aqui só volta ao campo.
  if (acao) query.action = acao
  if (ator) query.actorType = ator
  if (cursor) query.cursor = cursor
  const MSG = 'Use datas válidas, no formato dia/mês/ano do seletor.'
  if (atorInvalido) erro = 'Escolha quem agiu na lista, ou deixe em "Todos".'
  if (de) {
    if (isLocalDate(de)) query.from = localDayRange(de, PLATFORM_TIME_ZONE).start
    else erro = MSG
  }
  if (ate) {
    if (isLocalDate(ate)) query.to = localDayRange(ate, PLATFORM_TIME_ZONE).end
    else erro = MSG
  }
  return { query, values: { conta, acao, ator, de: query.from ? de : '', ate: query.to ? ate : '' }, erro }
}
