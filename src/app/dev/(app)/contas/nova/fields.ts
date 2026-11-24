import type { CoverMaterial } from '@/shared/theme/derive'

/** Tudo o que o assistente de nova conta guarda, em texto (como vem do formulário) e caixas marcadas. */
export type WizardValues = {
  // Dados
  name: string
  slug: string
  document: string
  contactEmail: string
  contactPhone: string
  // Marca
  displayName: string
  primary: string
  accent: string
  material: CoverMaterial
  // Módulos
  loyalty: boolean
  banners: boolean
  store: boolean
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
  ownerEmail: string
  ownerExisting: boolean
  emailSent: boolean
  /** O link que a loja passa aos clientes. */
  customerLinkUrl: string
  /** Passos depois da criação que falharam, em texto para a pessoa. */
  pendencias: string[]
}

/** Valores do formulário mais o resultado da criação (só existe depois que a conta foi criada). */
export type WizardData = WizardValues & { result?: WizardResult | undefined }

/** Valores iniciais: a marca padrão Agenda Flui e as regras que o banco já usa para conta nova. */
export const EMPTY_VALUES: WizardValues = {
  name: '',
  slug: '',
  document: '',
  contactEmail: '',
  contactPhone: '',
  displayName: '',
  primary: '#0B6E66',
  accent: '#F2A93B',
  material: 'LEATHER',
  loyalty: false,
  banners: false,
  store: false,
  slotStepMin: '15',
  minLeadMin: '60',
  maxAdvanceDays: '60',
  customerChangeWindowMin: '120',
  bufferMin: '0',
  autoConfirm: true,
  ownerName: '',
  ownerEmail: '',
}

export type StepId = 'dados' | 'marca' | 'modulos' | 'regras' | 'dono'

export const STEPS: ReadonlyArray<{ id: StepId; label: string; fields: readonly string[] }> = [
  { id: 'dados', label: 'Dados', fields: ['name', 'slug', 'document', 'contactEmail', 'contactPhone'] },
  { id: 'marca', label: 'Marca', fields: ['displayName', 'primary', 'accent', 'material'] },
  { id: 'modulos', label: 'Módulos', fields: ['loyalty', 'banners', 'store'] },
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

const BOOLEANOS = ['loyalty', 'banners', 'store', 'autoConfirm'] as const
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
