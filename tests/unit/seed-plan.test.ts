import { fitsWorkingHours, overlaps } from '@/server/domain/scheduling/slots'
import { addDays, todayIn, WEEKDAYS, weekdayOf, type Weekday } from '@/server/time'
import { DEMO_CONTAS } from '../../prisma/seed-data'
import { diaUtil, planejarAgenda, type Plano } from '../../prisma/seed-plan'

const RELOGIOS = {
  'quarta ao meio-dia': '2026-11-18T15:00:00Z',
  domingo: '2026-11-22T15:00:00Z',
  segunda: '2026-11-23T15:00:00Z',
  'sexta (amanhã é sábado)': '2026-11-20T15:00:00Z',
  'sábado à noite': '2026-11-22T01:00:00Z',
  'virada de dia entre os fusos': '2026-11-19T03:30:00Z',
}

function planoDe(conta: (typeof DEMO_CONTAS)[number], now: Date): Plano {
  const { agenda } = conta
  return planejarAgenda({
    now,
    timeZone: conta.fuso,
    expediente: agenda.expediente,
    profissionais: agenda.profissionais.map((_, i) => ({ id: `p${i}` })),
    servicos: agenda.servicos.map((s, i) => ({ id: `s${i}`, minutos: s.minutos, clube: s.clube ?? false })),
    clientes: agenda.clientes.map((c, i) => ({ id: `c${i}`, clube: c.clube ?? false })),
    combinacoes: agenda.combinacoes,
  })
}

function diasUteisDe(conta: (typeof DEMO_CONTAS)[number]): Weekday[] {
  return WEEKDAYS.filter((d) => (conta.agenda.expediente[d]?.length ?? 0) > 0)
}

describe.each(DEMO_CONTAS.map((c) => [c.nome, c] as const))('planejamento de %s', (_nome, conta) => {
  const uteis = diasUteisDe(conta)

  describe.each(Object.entries(RELOGIOS))('%s', (_rotulo, instante) => {
    const now = new Date(instante)
    const plano = planoDe(conta, now)
    const real = todayIn(conta.fuso, now)
    const ontem = diaUtil(addDays(real, -1), -1, uteis)
    const hoje = diaUtil(real, 1, uteis)
    const amanha = diaUtil(addDays(hoje, 1), 1, uteis)
    const faixasDe = (data: string) => conta.agenda.expediente[weekdayOf(data)] ?? []
    const intervalo = (m: { startsAt: Date; endsAt: Date }) => ({ start: m.startsAt, end: m.endsAt })

    test('são 23 marcações na distribuição do brief, em dias distintos para hoje e amanhã', () => {
      expect(plano.marcacoes).toHaveLength(23)
      expect(hoje).not.toBe(amanha)
      const doGrupo = (g: string) => plano.marcacoes.filter((m) => m.grupo === g)
      expect(doGrupo('ontem')).toHaveLength(6)
      expect(doGrupo('ontem').every((m) => m.data === ontem && m.desfecho === 'concluir')).toBe(true)
      expect(doGrupo('hoje')).toHaveLength(8)
      expect(doGrupo('hoje').every((m) => m.data === hoje)).toBe(true)
      expect(doGrupo('amanha')).toHaveLength(5)
      expect(doGrupo('amanha').every((m) => m.data === amanha && m.desfecho === 'confirmar')).toBe(true)
      const semana = doGrupo('semana')
      expect(semana).toHaveLength(3)
      for (const m of semana) {
        expect(m.data > amanha && m.data <= addDays(amanha, 7)).toBe(true)
        expect(m.desfecho).toBe('confirmar')
      }
      expect(new Set(semana.map((m) => m.data)).size).toBe(3)
      const cancelada = doGrupo('cancelada')
      expect(cancelada).toHaveLength(1)
      expect(cancelada[0]).toMatchObject({ data: amanha, desfecho: 'cancelar' })
    })

    test('os de hoje que já começaram são concluídos (um falta) e os outros ficam confirmados', () => {
      const deHoje = plano.marcacoes.filter((m) => m.grupo === 'hoje')
      const comecou = deHoje.filter((m) => m.startsAt.getTime() <= now.getTime())
      expect(deHoje.filter((m) => m.desfecho === 'faltar')).toHaveLength(comecou.length > 0 ? 1 : 0)
      for (const m of deHoje) {
        const esperado = m.startsAt.getTime() > now.getTime() ? ['confirmar'] : ['concluir', 'faltar']
        expect(esperado).toContain(m.desfecho)
      }
    })

    test('nenhuma sobreposição por profissional, nem com o bloqueio', () => {
      const bloco = { start: plano.bloco.startsAt, end: plano.bloco.endsAt }
      for (const [i, a] of plano.marcacoes.entries()) {
        if (a.professionalId === plano.bloco.professionalId) expect(overlaps(intervalo(a), bloco)).toBe(false)
        for (const b of plano.marcacoes.slice(i + 1)) {
          if (a.professionalId === b.professionalId) expect(overlaps(intervalo(a), intervalo(b))).toBe(false)
        }
      }
    })

    test('toda marcação cabe numa faixa do expediente, na grade de 15 minutos, e nada cai no fechamento', () => {
      for (const m of plano.marcacoes) {
        expect(m.minuto % 15).toBe(0)
        expect(
          fitsWorkingHours({ start: m.startsAt, end: m.endsAt, date: m.data, timeZone: conta.fuso, workingRanges: faixasDe(m.data) }),
        ).toBe(true)
        expect(m.data).not.toBe(plano.fechamento)
      }
      expect(uteis).toContain(weekdayOf(plano.fechamento))
      expect(plano.fechamento > amanha && plano.fechamento <= addDays(amanha, 7)).toBe(true)
    })

    test('o bloqueio ocupa as duas últimas horas do último intervalo de amanhã', () => {
      const faixas = faixasDe(amanha)
      const ultima = faixas[faixas.length - 1]
      expect(plano.bloco.data).toBe(amanha)
      expect(plano.bloco.endMin).toBe(ultima?.endMin)
      expect(plano.bloco.endMin - plano.bloco.startMin).toBe(120)
      expect((plano.bloco.endsAt.getTime() - plano.bloco.startsAt.getTime()) / 60_000).toBe(120)
    })

    test('o mesmo relógio dá o mesmo plano', () => {
      expect(planoDe(conta, new Date(instante))).toEqual(plano)
    })
  })

  test('diaUtil nos 7 dias da semana, nos dois sentidos', () => {
    for (let i = 0; i < 7; i += 1) {
      const de = addDays('2026-11-15', i)
      for (const sentido of [1, -1] as const) {
        const achado = diaUtil(de, sentido, uteis)
        expect(uteis).toContain(weekdayOf(achado))
        const passos = Math.abs(sentido === 1 ? addDaysDiff(de, achado) : addDaysDiff(achado, de))
        for (let p = 0; p < passos; p += 1) expect(uteis).not.toContain(weekdayOf(addDays(de, p * sentido)))
      }
    }
  })
})

/** Dias entre duas datas locais (`b` depois de `a`). */
function addDaysDiff(a: string, b: string): number {
  let n = 0
  for (let d = a; d < b; d = addDays(d, 1)) n += 1
  return n
}
