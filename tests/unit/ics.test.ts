import { buildIcs, type IcsEvent } from '@/server/domain/scheduling/ics'

const base: IcsEvent = {
  uid: 'abc-123',
  // 14:00 em São Paulo (UTC-3) = 17:00 UTC.
  startsAt: new Date('2026-11-18T17:00:00.000Z'),
  endsAt: new Date('2026-11-18T18:30:00.000Z'),
  stamp: new Date('2026-11-17T12:34:56.789Z'),
  summary: 'Banho e Hidratação para Thor em Focinho Feliz',
  description: 'Com Ana.\nPara mudar, abra https://app.exemplo.test/loja/horarios.',
  location: 'Rua das Flores, 10, São Paulo - SP',
  url: 'https://app.exemplo.test/loja/horarios',
}

describe('buildIcs', () => {
  test('datas em UTC no formato do arquivo e campos do evento', () => {
    const t = buildIcs(base)
    expect(t).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Agenda Flui//PT-BR\r\n')
    expect(t).toContain('METHOD:PUBLISH\r\n')
    expect(t).toContain('UID:abc-123@agendaflui\r\n')
    expect(t).toContain('DTSTAMP:20261117T123456Z\r\n')
    expect(t).toContain('DTSTART:20261118T170000Z\r\n')
    expect(t).toContain('DTEND:20261118T183000Z\r\n')
    expect(t).toContain('SUMMARY:Banho e Hidratação para Thor em Focinho Feliz\r\n')
    expect(t).toContain('URL:https://app.exemplo.test/loja/horarios\r\n')
    expect(t.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true)
  })

  test('escapa barra, ponto e vírgula, vírgula e quebra de linha', () => {
    const t = buildIcs({ ...base, summary: 'Banho, tosa; "x"\n', description: 'a\\b' })
    expect(t).toContain('SUMMARY:Banho\\, tosa\; "x"\\n\r\n')
    expect(t).toContain('DESCRIPTION:a\\\\b\r\n')
  })

  test('linha longa é dobrada em 75 octetos com CRLF e espaço, sem quebrar caractere', () => {
    const t = buildIcs({ ...base, description: 'ã'.repeat(100) })
    const linhas = t.split('\r\n')
    expect(linhas.every((l) => Buffer.byteLength(l) <= 75)).toBe(true)
    const i = linhas.findIndex((l) => l.startsWith('DESCRIPTION:'))
    expect(linhas[i + 1]?.startsWith(' ')).toBe(true)
    const desfeito = t.replace(/\r\n /g, '')
    expect(desfeito).toContain(`DESCRIPTION:${'ã'.repeat(100)}\r\n`)
    const comAscii = buildIcs({ ...base, description: 'x'.repeat(200) })
    expect(comAscii.replace(/\r\n /g, '')).toContain(`DESCRIPTION:${'x'.repeat(200)}\r\n`)
    expect(comAscii.split('\r\n').every((l) => l.length <= 75)).toBe(true)
  })

  test('sem local, não há LOCATION; termina em CRLF', () => {
    const t = buildIcs({ ...base, location: null })
    expect(t).not.toContain('LOCATION')
    expect(t.endsWith('\r\n')).toBe(true)
    expect(buildIcs(base)).toContain('LOCATION:Rua das Flores\\, 10\\, São Paulo - SP\r\n')
  })
})
