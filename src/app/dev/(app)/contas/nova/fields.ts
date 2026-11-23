import type { CoverMaterial, FontPair, PaperTone } from '@/shared/theme/derive'

/** Tudo o que o assistente de nova conta guarda, em texto (como vem do formulário) e caixas marcadas. */
export type WizardValues = {
  // Dados
  name: string
  slug: string
  timeZone: string
  legalName: string
  document: string
  contactEmail: string
  contactPhone: string
  internalNotes: string
  // Marca
  displayName: string
  primary: string
  accent: string
  material: CoverMaterial
  paper: PaperTone
  fontPair: FontPair
  loginMessage: string
  // Termos
  professionalSingular: string
  professionalPlural: string
  customerSingular: string
  customerPlural: string
  pointsSingular: string
  pointsPlural: string
  club: string
  // Módulos
  loyalty: boolean
  banners: boolean
  store: boolean
  vouchers: boolean
  // Regras de agenda
  slotStepMin: string
  minLeadMin: string
  maxAdvanceDays: string
  customerChangeWindowMin: string
  bufferMin: string
  autoConfirm: boolean
  // Dono
  ownerName: string
  ownerEmail: string
}

/** O que a ação devolve depois de criar a conta. */
export type WizardResult = {
  createdId: string
  businessName: string
  entryUrl: string
  ownerEmail: string
  ownerExisting: boolean
  emailSent: boolean
  /** Passos depois da criação que falharam, em texto para a pessoa. */
  pendencias: string[]
}

/** Valores do formulário mais o resultado da criação (só existe depois que a conta foi criada). */
export type WizardData = WizardValues & { result?: WizardResult | undefined }

/** Valores iniciais: a marca padrão AgendaFlui, os termos e as regras que o banco já usa para conta nova. */
export const EMPTY_VALUES: WizardValues = {
  name: '',
  slug: '',
  timeZone: 'America/Sao_Paulo',
  legalName: '',
  document: '',
  contactEmail: '',
  contactPhone: '',
  internalNotes: '',
  displayName: '',
  primary: '#0B6E66',
  accent: '#F2A93B',
  material: 'LEATHER',
  paper: 'CREAM',
  fontPair: 'CLASSIC',
  loginMessage: '',
  professionalSingular: 'Profissional',
  professionalPlural: 'Profissionais',
  customerSingular: 'Cliente',
  customerPlural: 'Clientes',
  pointsSingular: 'Ponto',
  pointsPlural: 'Pontos',
  club: 'Clube',
  loyalty: false,
  banners: false,
  store: false,
  vouchers: false,
  slotStepMin: '15',
  minLeadMin: '60',
  maxAdvanceDays: '60',
  customerChangeWindowMin: '120',
  bufferMin: '0',
  autoConfirm: true,
  ownerName: '',
  ownerEmail: '',
}

export type StepId = 'dados' | 'marca' | 'termos' | 'modulos' | 'regras' | 'dono'

export const STEPS: ReadonlyArray<{ id: StepId; label: string; fields: readonly string[] }> = [
  { id: 'dados', label: 'Dados', fields: ['name', 'slug', 'timeZone', 'legalName', 'document', 'contactEmail', 'contactPhone', 'internalNotes'] },
  { id: 'marca', label: 'Marca', fields: ['displayName', 'primary', 'accent', 'material', 'paper', 'fontPair', 'loginMessage'] },
  {
    id: 'termos',
    label: 'Termos',
    fields: ['professionalSingular', 'professionalPlural', 'customerSingular', 'customerPlural', 'pointsSingular', 'pointsPlural', 'club'],
  },
  { id: 'modulos', label: 'Módulos', fields: ['loyalty', 'banners', 'store', 'vouchers'] },
  {
    id: 'regras',
    label: 'Regras de agenda',
    fields: ['slotStepMin', 'minLeadMin', 'maxAdvanceDays', 'customerChangeWindowMin', 'bufferMin', 'autoConfirm'],
  },
  { id: 'dono', label: 'Dono', fields: ['ownerName', 'ownerEmail'] },
]

/** Nomes que o domínio usa nos erros e que diferem dos do formulário. */
const NOME_DO_DOMINIO: Record<string, string> = { 'owner.name': 'ownerName', 'owner.email': 'ownerEmail' }

/** Etapa (posição na lista, a partir de 0) de um campo com erro; `null` se o campo não é do assistente. */
export function stepOfField(field: string): number | null {
  const nome = NOME_DO_DOMINIO[field] ?? field
  const i = STEPS.findIndex((s) => s.fields.includes(nome))
  return i === -1 ? null : i
}

/** A primeira etapa, na ordem das etapas, que tem algum campo com erro. */
export function firstStepWithError(fields: Record<string, string>): number | null {
  const com = Object.keys(fields)
    .map(stepOfField)
    .filter((i): i is number => i !== null)
  return com.length === 0 ? null : Math.min(...com)
}

/** Etapas com erro, sem repetir, em ordem. */
export function stepsWithError(fields: Record<string, string>): number[] {
  return [...new Set(Object.keys(fields).map(stepOfField).filter((i): i is number => i !== null))].sort((a, b) => a - b)
}

const BOOLEANOS = ['loyalty', 'banners', 'store', 'vouchers', 'autoConfirm'] as const
const TEXTOS = Object.keys(EMPTY_VALUES).filter((k) => !(BOOLEANOS as readonly string[]).includes(k)) as Array<
  Exclude<keyof WizardValues, (typeof BOOLEANOS)[number]>
>

/** Só os valores do formulário: sem a logo (arquivo) e sem o resultado da criação. */
export function pickValues(d: WizardData): WizardValues {
  const v: WizardValues = { ...EMPTY_VALUES }
  const escrever = v as Record<string, string | boolean>
  for (const k of Object.keys(EMPTY_VALUES) as Array<keyof WizardValues>) escrever[k] = d[k]
  return v
}

/** Lê o formulário. Texto que falta vale o padrão; caixa que falta vale "desmarcada". A logo não vai aqui: tem rota própria. */
export function readValues(fd: FormData): WizardData {
  const v: WizardValues = { ...EMPTY_VALUES }
  const escrever = v as Record<string, string | boolean>
  for (const k of TEXTOS) {
    const bruto = fd.get(k)
    if (typeof bruto === 'string') escrever[k] = bruto
  }
  for (const k of BOOLEANOS) v[k] = fd.get(k) === 'on'
  return v
}

export type TermSet = Pick<
  WizardValues,
  'professionalSingular' | 'professionalPlural' | 'customerSingular' | 'customerPlural' | 'pointsSingular' | 'pointsPlural' | 'club'
>

/** Sugestões por ramo: só preenchem os campos de termos; a pessoa ajusta depois. */
export const TERM_PRESETS: ReadonlyArray<{ label: string; terms: TermSet }> = [
  {
    label: 'Barbearia',
    terms: { professionalSingular: 'Barbeiro', professionalPlural: 'Barbeiros', customerSingular: 'Cliente', customerPlural: 'Clientes', pointsSingular: 'Ponto', pointsPlural: 'Pontos', club: 'Clube' },
  },
  {
    label: 'Pet shop',
    terms: { professionalSingular: 'Tosador', professionalPlural: 'Tosadores', customerSingular: 'Tutor', customerPlural: 'Tutores', pointsSingular: 'Patinha', pointsPlural: 'Patinhas', club: 'Clube' },
  },
  {
    label: 'Clínica',
    terms: { professionalSingular: 'Terapeuta', professionalPlural: 'Terapeutas', customerSingular: 'Paciente', customerPlural: 'Pacientes', pointsSingular: 'Ponto', pointsPlural: 'Pontos', club: 'Programa' },
  },
  {
    label: 'Estúdio',
    terms: { professionalSingular: 'Instrutor', professionalPlural: 'Instrutores', customerSingular: 'Aluno', customerPlural: 'Alunos', pointsSingular: 'Ponto', pointsPlural: 'Pontos', club: 'Clube' },
  },
]

/** Fusos do Brasil, do mais usado ao menos usado. O domínio confere o valor de qualquer jeito. */
export const FUSOS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'America/Sao_Paulo', label: 'Brasília (São Paulo, Rio, Belo Horizonte)' },
  { value: 'America/Manaus', label: 'Amazonas (Manaus)' },
  { value: 'America/Cuiaba', label: 'Mato Grosso (Cuiabá)' },
  { value: 'America/Campo_Grande', label: 'Mato Grosso do Sul (Campo Grande)' },
  { value: 'America/Fortaleza', label: 'Nordeste (Fortaleza)' },
  { value: 'America/Recife', label: 'Pernambuco (Recife)' },
  { value: 'America/Bahia', label: 'Bahia (Salvador)' },
  { value: 'America/Belem', label: 'Pará (Belém)' },
  { value: 'America/Porto_Velho', label: 'Rondônia (Porto Velho)' },
  { value: 'America/Rio_Branco', label: 'Acre (Rio Branco)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha' },
]

/** "Pata Viva Pet Shop" vira "pata-viva-pet-shop": sugestão de identificador, sem acento e com hífens. */
export function slugify(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
}
