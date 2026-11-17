import type { FormState } from '../../_lib/form-state'

/** Campos de um formulário da conta, em texto, como vêm do navegador. Caixa marcada vale `'on'`; desmarcada, `''`. */
export type Campos = Record<string, string>
export type EstadoConta = FormState<Campos>
/** Ação de formulário da conta já com o id da conta ligado no servidor (`acao.bind(null, id)`). */
export type AcaoConta = (prev: EstadoConta, form: FormData) => Promise<EstadoConta>

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
  primary: 'Cor da conta',
  accent: 'Cor de destaque',
  material: 'Barra lateral',
  paper: 'Fundo',
  fontPair: 'Fontes',
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
