import { addDays, minuteToInstant, todayIn, WEEKDAYS, weekdayOf, type Weekday } from '../src/server/time'
import type { DemoExpediente } from './seed-data'

/** Primeiro dia com expediente a partir de `de` (inclusive), andando no sentido pedido (1 = futuro, -1 = passado). */
export function diaUtil(de: string, sentido: 1 | -1, diasUteis: readonly Weekday[]): string {
  let data = de
  for (let i = 0; i < 7; i += 1) {
    if (diasUteis.includes(weekdayOf(data))) return data
    data = addDays(data, sentido)
  }
  throw new RangeError('Informe ao menos um dia da semana com expediente.')
}

const GRADE_MIN = 15
const PROFISSIONAIS = 3
const BLOQUEIO_MIN = 120

type Faixa = { startMin: number; endMin: number }

export type Grupo = 'ontem' | 'hoje' | 'amanha' | 'semana' | 'cancelada'
export type Desfecho = 'concluir' | 'faltar' | 'confirmar' | 'cancelar'

export type PlanoMarcacao = {
  grupo: Grupo
  professionalId: string
  customerId: string
  serviceIds: string[]
  /** Data local, minuto do dia local e os instantes correspondentes. */
  data: string
  minuto: number
  startsAt: Date
  endsAt: Date
  desfecho: Desfecho
}

export type Plano = {
  marcacoes: PlanoMarcacao[]
  bloco: { professionalId: string; data: string; startMin: number; endMin: number; startsAt: Date; endsAt: Date }
  /** Dia do fechamento "Feriado"; é gravado por último, e marca a agenda como completa. */
  fechamento: string
}

export type PlanoEntrada = {
  now: Date
  timeZone: string
  expediente: DemoExpediente
  profissionais: { id: string }[]
  servicos: { id: string; minutos: number; clube: boolean }[]
  clientes: { id: string; clube: boolean }[]
  /** Combinações de serviços (índices em `servicos`) em rodízio. */
  combinacoes: number[][]
}

/** Minuto do dia que fica a `fracao` do expediente, contando só as horas de trabalho. */
function alvoNoExpediente(faixas: readonly Faixa[], fracao: number): number {
  const total = faixas.reduce((soma, f) => soma + (f.endMin - f.startMin), 0)
  let falta = Math.round((total * fracao) / GRADE_MIN) * GRADE_MIN
  for (const f of faixas) {
    const tamanho = f.endMin - f.startMin
    if (falta < tamanho) return f.startMin + falta
    falta -= tamanho
  }
  return faixas[0]?.startMin ?? 0
}

/** Primeiro início na grade, a partir do alvo, que cabe no expediente sem tocar nos horários ocupados. */
function inicioLivre(faixas: readonly Faixa[], ocupado: readonly Faixa[], duracao: number, alvo: number): number | null {
  const candidatos: number[] = []
  for (const f of faixas) {
    for (let m = Math.ceil(f.startMin / GRADE_MIN) * GRADE_MIN; m + duracao <= f.endMin; m += GRADE_MIN) {
      if (!ocupado.some((o) => m < o.endMin && o.startMin < m + duracao)) candidatos.push(m)
    }
  }
  return candidatos.find((m) => m >= alvo) ?? candidatos[0] ?? null
}

type Pedido = { grupo: Grupo; data: string; profissional: number; fracao: number }

/** Distribui `quantidade` marcações no mesmo dia, em rodízio entre os profissionais e espalhadas pelo expediente. */
function pedidosDoDia(grupo: Grupo, data: string, quantidade: number): Pedido[] {
  const rodadas = Math.ceil(quantidade / PROFISSIONAIS)
  return Array.from({ length: quantidade }, (_, i) => ({
    grupo,
    data,
    profissional: i % PROFISSIONAIS,
    fracao: 0.1 + Math.floor(i / PROFISSIONAIS) * (0.8 / rodadas),
  }))
}

/**
 * Planejamento puro (sem banco) da agenda de demonstração, relativo ao "hoje" da conta no fuso dela.
 *
 * - ontem: dia útil anterior a ontem (inclusive); 6 concluídos.
 * - hoje: o próprio dia, ou o próximo dia útil se hoje não tem expediente; 8 marcações.
 * - amanhã: o primeiro dia útil DEPOIS do "hoje" usado, para os 8 de hoje e os 5 de amanhã nunca caírem no
 *   mesmo dia (com hoje sem expediente, "hoje" já é o próximo dia útil e "amanhã" é o seguinte a ele).
 * - semana seguinte: os dias úteis dos 7 dias depois de amanhã; o 2º é o fechamento, e as 3 marcações ficam no
 *   1º, 3º e 5º.
 * - bloqueio: as duas últimas horas do último intervalo de expediente de amanhã, para o 2º profissional.
 */
export function planejarAgenda(i: PlanoEntrada): Plano {
  const tz = i.timeZone
  if (i.profissionais.length !== PROFISSIONAIS) throw new Error('A demonstração precisa de três profissionais.')
  if (i.clientes.length === 0 || i.servicos.length === 0) throw new Error('A demonstração precisa de clientes e serviços.')
  const uteis = WEEKDAYS.filter((dia) => (i.expediente[dia]?.length ?? 0) > 0)
  const faixasDe = (data: string): Faixa[] => i.expediente[weekdayOf(data)] ?? []
  const real = todayIn(tz, i.now)
  const ontem = diaUtil(addDays(real, -1), -1, uteis)
  const hoje = diaUtil(real, 1, uteis)
  const amanha = diaUtil(addDays(hoje, 1), 1, uteis)
  const semana = Array.from({ length: 7 }, (_, n) => addDays(amanha, n + 1)).filter((dia) => uteis.includes(weekdayOf(dia)))
  const fechamento = semana[1]
  const diasDaSemana = [semana[0], semana[2], semana[4]]
  if (fechamento === undefined || diasDaSemana.some((dia) => dia === undefined)) {
    throw new Error('A semana seguinte não tem dias úteis suficientes para a demonstração.')
  }

  const ocupado = new Map<string, Faixa[]>()
  const chaveDe = (profissional: number, data: string) => `${profissional}|${data}`
  const faixasAmanha = faixasDe(amanha)
  const ultima = faixasAmanha[faixasAmanha.length - 1]
  if (!ultima || ultima.endMin - ultima.startMin < BLOQUEIO_MIN) throw new Error('O dia seguinte não tem expediente.')
  const blocoMin = { startMin: ultima.endMin - BLOQUEIO_MIN, endMin: ultima.endMin }
  const donoDoBloco = i.profissionais[1]
  if (!donoDoBloco) throw new Error('A demonstração precisa de três profissionais.')
  ocupado.set(chaveDe(1, amanha), [blocoMin])

  const pedidos: Pedido[] = [
    ...pedidosDoDia('ontem', ontem, 6),
    ...pedidosDoDia('hoje', hoje, 8),
    ...pedidosDoDia('amanha', amanha, 5),
    ...[0.15, 0.45, 0.7].map((fracao, n): Pedido => ({ grupo: 'semana', data: diasDaSemana[n] ?? amanha, profissional: n, fracao })),
    { grupo: 'cancelada', data: amanha, profissional: 2, fracao: 0.6 },
  ]

  const marcacoes: PlanoMarcacao[] = []
  for (const [c, p] of pedidos.entries()) {
    const cliente = i.clientes[(c * 5) % i.clientes.length]
    if (!cliente) throw new Error('A demonstração precisa de clientes.')
    const combinacao = i.combinacoes[c % i.combinacoes.length] ?? [0]
    const escolhidos = combinacao.flatMap((n) => {
      const s = i.servicos[n]
      return s && (!s.clube || cliente.clube) ? [s] : []
    })
    const lista = escolhidos.length > 0 ? escolhidos : i.servicos.slice(0, 1)
    const duracao = lista.reduce((soma, s) => soma + s.minutos, 0)
    const faixas = faixasDe(p.data)
    let achado: { profissional: number; minuto: number } | null = null
    for (let tentativa = 0; tentativa < PROFISSIONAIS && !achado; tentativa += 1) {
      const profissional = (p.profissional + tentativa) % PROFISSIONAIS
      const ja = ocupado.get(chaveDe(profissional, p.data)) ?? []
      const alvo = alvoNoExpediente(faixas, p.fracao) + profissional * GRADE_MIN
      const minuto = inicioLivre(faixas, ja, duracao, alvo)
      if (minuto !== null) achado = { profissional, minuto }
    }
    const dono = achado ? i.profissionais[achado.profissional] : undefined
    if (!achado || !dono) throw new Error(`Não há horário livre em ${p.data} para a demonstração.`)
    const chave = chaveDe(achado.profissional, p.data)
    ocupado.set(chave, [...(ocupado.get(chave) ?? []), { startMin: achado.minuto, endMin: achado.minuto + duracao }])
    const startsAt = minuteToInstant(p.data, achado.minuto, tz)
    const endsAt = minuteToInstant(p.data, achado.minuto + duracao, tz)
    const comecou = startsAt.getTime() <= i.now.getTime()
    marcacoes.push({
      grupo: p.grupo,
      professionalId: dono.id,
      customerId: cliente.id,
      serviceIds: lista.map((s) => s.id),
      data: p.data,
      minuto: achado.minuto,
      startsAt,
      endsAt,
      desfecho: p.grupo === 'ontem' ? 'concluir' : p.grupo === 'cancelada' ? 'cancelar' : p.grupo === 'hoje' && comecou ? 'concluir' : 'confirmar',
    })
  }

  // Dos de hoje que já começaram, o último a começar é a falta.
  const faltou = marcacoes
    .filter((m) => m.grupo === 'hoje' && m.desfecho === 'concluir')
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0]
  if (faltou) faltou.desfecho = 'faltar'

  return {
    marcacoes,
    bloco: {
      professionalId: donoDoBloco.id,
      data: amanha,
      ...blocoMin,
      startsAt: minuteToInstant(amanha, blocoMin.startMin, tz),
      endsAt: minuteToInstant(amanha, blocoMin.endMin, tz),
    },
    fechamento,
  }
}
