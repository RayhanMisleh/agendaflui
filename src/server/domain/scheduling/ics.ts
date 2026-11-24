import type { TenantContext } from '@/server/auth/actor'
import { getAppointment } from '@/server/domain/scheduling/appointments'
import { toIsoInstant } from '@/server/time'

export type IcsEvent = {
  uid: string
  startsAt: Date
  endsAt: Date
  stamp: Date
  summary: string
  description: string
  location: string | null
  url: string
}

const CRLF = '\r\n'

/** `2026-11-17T15:00:00.000Z` → `20261117T150000Z`. */
function utc(d: Date): string {
  return toIsoInstant(d).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** Texto do arquivo de agenda: `\`, `;`, `,` e quebra de linha com barra; o resto passa. */
function escapeText(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** Dobra a linha em 75 octetos (UTF-8, sem cortar caractere no meio); as continuações começam com um espaço. */
function fold(line: string): string {
  const out: string[] = []
  let atual = ''
  let bytes = 0
  for (const ch of line) {
    const n = Buffer.byteLength(ch)
    // A continuação já gasta 1 octeto com o espaço inicial.
    const limite = out.length === 0 ? 75 : 74
    if (bytes + n > limite) {
      out.push(atual)
      atual = ''
      bytes = 0
    }
    atual += ch
    bytes += n
  }
  out.push(atual)
  return out.join(`${CRLF} `)
}

/** Um compromisso (`VEVENT`) no formato iCalendar (RFC 5545), com datas em UTC e linhas separadas por CRLF. */
export function buildIcs(e: IcsEvent): string {
  const linhas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agenda Flui//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@agendaflui`,
    `DTSTAMP:${utc(e.stamp)}`,
    `DTSTART:${utc(e.startsAt)}`,
    `DTEND:${utc(e.endsAt)}`,
    `SUMMARY:${escapeText(e.summary)}`,
    `DESCRIPTION:${escapeText(e.description)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    `URL:${e.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return linhas.map(fold).join(CRLF) + CRLF
}

/** "Banho", "Banho e Tosa", "Banho, Tosa e Spa". */
function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join('')
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`
}

/**
 * O arquivo do agendamento, só pelo `getAppointment` (o cliente vê só o próprio; de outro, `not_found`). `petName` entra no
 * título quando a loja é de pet shop ("Banho para Thor em Focinho Feliz").
 */
export async function appointmentIcs(
  ctx: TenantContext,
  id: string,
  i: { storeName: string; address: string | null; url: string; petName?: string | null },
): Promise<{ filename: string; body: string }> {
  const a = await getAppointment(ctx, id)
  const servicos = listaDeNomes(a.items.map((item) => item.name))
  const para = i.petName ? ` para ${i.petName}` : ''
  return {
    filename: `horario-${a.local.date}.ics`,
    body: buildIcs({
      uid: a.id,
      startsAt: a.startsAt,
      endsAt: a.endsAt,
      stamp: ctx.clock(),
      summary: `${servicos}${para} em ${i.storeName}`,
      description: `Com ${a.professional.name}.\nPara mudar, abra ${i.url}.`,
      location: i.address,
      url: i.url,
    }),
  }
}
