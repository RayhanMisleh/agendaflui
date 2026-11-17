import type { TenantContext } from '@/server/auth/actor'
import { readReportPage, type ReportRow } from '@/server/domain/reports/detail'
import { resolveScope, type ReportFilter } from '@/server/domain/reports/shared'

const BOM = '﻿'
const EOL = '\r\n'
const PAGE = 500

const STATUS_LABEL: Record<ReportRow['status'], string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  COMPLETED: 'Concluído',
  CANCELED: 'Cancelado',
  NO_SHOW: 'Não compareceu',
}

const HEADER = ['Início', 'Término', 'Cliente', 'Profissional', 'Serviços', 'Situação', 'Valor', 'Comissão']

/**
 * Uma célula do CSV (separador `;`). Texto que começa com `=`, `+`, `-`, `@`, tabulação ou retorno de carro (também depois de espaços ou
 * tabulações à esquerda) ganha um apóstrofo na frente, para a planilha não o executar como fórmula. Números não passam por essa regra. Aspas dobradas.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]|^[ \t]*[=+\-@]/.test(text)) text = `'${text}`
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Centavos em reais com vírgula decimal e sem símbolo: 8050 vira `80,50`. */
export function moneyCell(cents: number | null): string {
  if (cents === null) return ''
  const abs = Math.abs(cents)
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

function line(cells: string[]): string {
  return cells.join(';') + EOL
}

/**
 * CSV do relatório detalhado, em fluxo: lê de 500 em 500 e entrega cada página como um pedaço. O primeiro pedaço traz o
 * BOM e o cabeçalho. Permissão e período são conferidos antes do primeiro pedaço, no primeiro `next()`.
 */
export async function* reportCsv(ctx: TenantContext, f: ReportFilter): AsyncGenerator<string, void, undefined> {
  const scope = await resolveScope(ctx, f)
  let head = BOM + line(HEADER.map(csvCell))
  let cursor: string | undefined
  do {
    const page = await readReportPage(ctx, scope, cursor, PAGE)
    const body = page.items
      .map((r) =>
        line([
          csvCell(r.startLabel),
          csvCell(r.endLabel),
          csvCell(r.customerName),
          csvCell(r.professionalName),
          csvCell(r.services.join(', ')),
          csvCell(STATUS_LABEL[r.status]),
          moneyCell(r.status === 'COMPLETED' ? r.totalCents : null),
          moneyCell(r.commissionCents),
        ]),
      )
      .join('')
    yield head + body
    head = ''
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
}
