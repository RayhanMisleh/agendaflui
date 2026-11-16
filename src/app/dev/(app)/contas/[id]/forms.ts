import type { FormState } from '../../_lib/form-state'

/** Campos de um formulário da conta, em texto, como vêm do navegador. Caixa marcada vale `'on'`; desmarcada, `''`. */
export type Campos = Record<string, string>
export type EstadoConta = FormState<Campos>

export const MSG_CONFLITO = 'Outra pessoa alterou esta conta. Recarregue para ver a versão atual.'

/** Estado inicial de um formulário: os valores que o servidor leu agora. */
export function estadoInicial(values: Campos): EstadoConta {
  return { ok: false, message: null, fields: {}, values }
}

/** Nome legível de cada campo, para a lista de erros no alto do formulário. */
export const ROTULOS: Record<string, string> = {
  name: 'Nome da conta',
  slug: 'Identificador',
  legalName: 'Razão social',
  document: 'CPF ou CNPJ',
  contactEmail: 'E-mail de contato',
  contactPhone: 'Telefone',
  internalNotes: 'Observações internas',
  displayName: 'Nome de exibição',
  primary: 'Cor principal',
  accent: 'Cor de destaque',
  material: 'Material da capa',
  paper: 'Tom do papel',
  fontPair: 'Par de fontes',
  loginMessage: 'Mensagem da tela de entrada',
  professionalSingular: 'Profissional (singular)',
  professionalPlural: 'Profissional (plural)',
  customerSingular: 'Cliente (singular)',
  customerPlural: 'Cliente (plural)',
  pointsSingular: 'Pontos (singular)',
  pointsPlural: 'Pontos (plural)',
  club: 'Clube',
  vouchers: 'Vouchers',
  store: 'Loja',
  slotStepMin: 'Grade de horários',
  minLeadMin: 'Antecedência mínima',
  maxAdvanceDays: 'Alcance da agenda',
  customerChangeWindowMin: 'Prazo para o cliente mudar',
  bufferMin: 'Intervalo entre atendimentos',
  timeZone: 'Fuso horário',
  origins: 'Origens permitidas',
  confirmName: 'Confirmação',
  version: 'Versão',
}

/** Os avisos que o sistema manda, com o nome que a pessoa entende. */
export const AVISOS: ReadonlyArray<{ kind: string; label: string }> = [
  { kind: 'APPOINTMENT_REQUESTED', label: 'Pedido de agendamento recebido' },
  { kind: 'APPOINTMENT_CONFIRMED', label: 'Agendamento confirmado' },
  { kind: 'APPOINTMENT_CANCELED', label: 'Agendamento cancelado' },
  { kind: 'APPOINTMENT_RESCHEDULED', label: 'Agendamento remarcado' },
  { kind: 'APPOINTMENT_REMINDER_24H', label: 'Lembrete 24 horas antes' },
  { kind: 'APPOINTMENT_REMINDER_1H', label: 'Lembrete 1 hora antes' },
  { kind: 'APPOINTMENT_COMPLETED', label: 'Atendimento concluído' },
  { kind: 'PROFESSIONAL_FREE_EARLY', label: 'Profissional livre mais cedo' },
  { kind: 'STAFF_NEW_APPOINTMENT', label: 'Equipe: novo agendamento' },
  { kind: 'STAFF_APPOINTMENT_CANCELED', label: 'Equipe: agendamento cancelado' },
  { kind: 'STAFF_APPOINTMENT_RESCHEDULED', label: 'Equipe: agendamento remarcado' },
]
