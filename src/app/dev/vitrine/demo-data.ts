import type { Tone } from '@/ui/components'

export type ScenarioKind = 'pet' | 'barbearia'

export type Appointment = {
  id: string
  /** Minutos desde 00:00. */
  start: number
  duration: number
  client: string
  service: string
  professional: string
  status: { label: string; tone: Tone }
}

export type ClientRow = { id: string; name: string; detail: string; phone: string; lastVisit: string; points: number }

export type Scenario = {
  kind: ScenarioKind
  clientWord: { one: string; many: string }
  dateLabel: string
  user: { name: string; roleLabel: string }
  professionals: Array<{ id: string; name: string }>
  appointments: Appointment[]
  /** Minuto do dia marcado pela fita. */
  now: number
  counters: { today: number; revenueCents: number; occupancy: number }
  afternoon: string
  clients: ClientRow[]
  services: Array<{ id: string; label: string; cents: number }>
}

export const DAY_START = 8 * 60
export const DAY_END = 13 * 60

export function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const DONE = { label: 'Concluído', tone: 'neutral' } as const
const OK = { label: 'Confirmado', tone: 'ok' } as const
const PENDING = { label: 'Pendente', tone: 'warn' } as const
const MISSED = { label: 'Faltou', tone: 'bad' } as const

export const SCENARIOS: Record<ScenarioKind, Scenario> = {
  pet: {
    kind: 'pet',
    clientWord: { one: 'Tutor', many: 'Tutores' },
    dateLabel: 'Sexta-feira, 13 de novembro',
    user: { name: 'Marina Lopes', roleLabel: 'Dona' },
    professionals: [
      { id: 'rafael', name: 'Rafael' },
      { id: 'camila', name: 'Camila' },
      { id: 'leticia', name: 'Letícia' },
    ],
    appointments: [
      { id: 'a1', start: 8 * 60, duration: 90, client: 'Thor, labrador', service: 'Banho e tosa higiênica', professional: 'Rafael', status: DONE },
      { id: 'a2', start: 9 * 60 + 45, duration: 45, client: 'Mel, shih-tzu', service: 'Banho', professional: 'Camila', status: MISSED },
      { id: 'a3', start: 11 * 60, duration: 60, client: 'Pipoca, poodle', service: 'Hidratação de pelagem', professional: 'Camila', status: OK },
      { id: 'a4', start: 12 * 60 + 15, duration: 30, client: 'Bidu, vira-lata', service: 'Corte de unhas', professional: 'Rafael', status: PENDING },
    ],
    now: 10 * 60 + 40,
    counters: { today: 12, revenueCents: 128000, occupancy: 78 },
    afternoon: 'À tarde: 8 atendimentos, a partir das 14:00.',
    clients: [
      { id: 'c1', name: 'Beatriz Almeida', detail: 'Thor, labrador', phone: '(11) 98421-7733', lastVisit: '13 de nov.', points: 240 },
      { id: 'c2', name: 'Carlos Nogueira', detail: 'Mel, shih-tzu', phone: '(11) 97755-2086', lastVisit: '30 de out.', points: 120 },
      { id: 'c3', name: 'Juliana Prado', detail: 'Pipoca, poodle', phone: '(11) 99312-4410', lastVisit: '6 de nov.', points: 385 },
      { id: 'c4', name: 'Heitor Campos', detail: 'Bidu, vira-lata', phone: '(11) 96640-9921', lastVisit: '23 de out.', points: 60 },
    ],
    services: [
      { id: 's1', label: 'Banho', cents: 6500 },
      { id: 's2', label: 'Banho e tosa higiênica', cents: 9500 },
      { id: 's3', label: 'Hidratação de pelagem', cents: 7000 },
      { id: 's4', label: 'Corte de unhas', cents: 3000 },
    ],
  },
  barbearia: {
    kind: 'barbearia',
    clientWord: { one: 'Cliente', many: 'Clientes' },
    dateLabel: 'Sexta-feira, 13 de novembro',
    user: { name: 'Wellington Cruz', roleLabel: 'Dono' },
    professionals: [
      { id: 'diego', name: 'Diego' },
      { id: 'thiago', name: 'Thiago' },
      { id: 'otavio', name: 'Otávio' },
    ],
    appointments: [
      { id: 'a1', start: 8 * 60, duration: 60, client: 'Rogério Tavares', service: 'Corte e barba', professional: 'Diego', status: DONE },
      { id: 'a2', start: 9 * 60 + 15, duration: 30, client: 'Marcelo Fontes', service: 'Barba na navalha', professional: 'Thiago', status: MISSED },
      { id: 'a3', start: 10 * 60 + 45, duration: 45, client: 'Eduardo Lins', service: 'Corte degradê', professional: 'Diego', status: OK },
      { id: 'a4', start: 12 * 60, duration: 60, client: 'André Pacheco', service: 'Corte, barba e sobrancelha', professional: 'Thiago', status: PENDING },
    ],
    now: 10 * 60 + 20,
    counters: { today: 9, revenueCents: 94000, occupancy: 71 },
    afternoon: 'À tarde: 5 atendimentos, a partir das 14:00.',
    clients: [
      { id: 'c1', name: 'Rogério Tavares', detail: 'Corte e barba, a cada 15 dias', phone: '(21) 98830-1175', lastVisit: '13 de nov.', points: 310 },
      { id: 'c2', name: 'Marcelo Fontes', detail: 'Barba na navalha', phone: '(21) 97214-6032', lastVisit: '25 de out.', points: 90 },
      { id: 'c3', name: 'Eduardo Lins', detail: 'Corte degradê', phone: '(21) 99571-8846', lastVisit: '1 de nov.', points: 205 },
      { id: 'c4', name: 'André Pacheco', detail: 'Corte, barba e sobrancelha', phone: '(21) 96108-3350', lastVisit: '30 de out.', points: 450 },
    ],
    services: [
      { id: 's1', label: 'Corte degradê', cents: 5500 },
      { id: 's2', label: 'Corte e barba', cents: 8500 },
      { id: 's3', label: 'Barba na navalha', cents: 4000 },
      { id: 's4', label: 'Corte, barba e sobrancelha', cents: 9500 },
    ],
  },
}
