/*
 * Máquina do Agendar: funções puras, sem React. O fluxo anda por passos (pet, serviços, profissional, horário, confirmar);
 * cada escolha limpa o que depende dela, e um horário tomado entre escolher e confirmar volta ao passo do horário mantendo o
 * resto. `AgendarFluxo` só despacha ações e desenha o passo atual.
 */

export type FluxoPasso = 'pet' | 'servicos' | 'profissional' | 'horario' | 'confirmar'
export type Sugestao = { iso: string; label: string; date: string }

export type FluxoEstado = {
  modo: 'novo' | 'remarcar'
  passos: FluxoPasso[]
  passo: FluxoPasso
  direction: 1 | -1
  petId: string | null
  serviceIds: string[]
  professionalId: string | null
  /** A pessoa já decidiu o profissional ("Qualquer um" também é uma decisão). */
  professionalChosen: boolean
  date: string | null
  /** Instante ISO do horário escolhido. */
  startsAt: string | null
  /** O rótulo local dele ("14:30"), como a loja o ofereceu. */
  startsLabel: string | null
  note: string
  /** Chave de idempotência do fluxo: nasce uma vez e não muda. */
  key: string
  aviso: string | null
  sugestoes: Sugestao[]
  /** Só um profissional faz os serviços escolhidos: o passo do profissional some. */
  semProfissional: boolean
  /** O fluxo começa sem passo de pet (um só pet agendável, ou loja sem pets). */
  semPet: boolean
}

export type FluxoAcao =
  | { type: 'pet'; petId: string }
  | { type: 'servico'; serviceId: string }
  | { type: 'profissional'; id: string | null }
  | { type: 'unico'; id: string }
  | { type: 'dia'; date: string }
  | { type: 'horario'; iso: string; label: string }
  | { type: 'nota'; text: string }
  | { type: 'avancar' }
  | { type: 'voltar' }
  | { type: 'ir'; passo: FluxoPasso }
  | { type: 'ocupado'; message: string; sugestoes: Sugestao[] }

function passosDe(modo: 'novo' | 'remarcar', o: { semPet: boolean; semProfissional: boolean }): FluxoPasso[] {
  if (modo === 'remarcar') return ['profissional', 'horario', 'confirmar']
  const todos: FluxoPasso[] = ['pet', 'servicos', 'profissional', 'horario', 'confirmar']
  return todos.filter((p) => !(p === 'pet' && o.semPet) && !(p === 'profissional' && o.semProfissional))
}

export function podeAvancar(s: FluxoEstado): boolean {
  switch (s.passo) {
    case 'pet':
      return s.petId !== null
    case 'servicos':
      return s.serviceIds.length > 0
    case 'profissional':
      return s.professionalChosen
    case 'horario':
      return s.startsAt !== null
    case 'confirmar':
      return true
  }
}

function completo(s: Pick<FluxoEstado, 'petId' | 'serviceIds' | 'professionalChosen' | 'startsAt'>, p: FluxoPasso): boolean {
  switch (p) {
    case 'pet':
      return s.petId !== null
    case 'servicos':
      return s.serviceIds.length > 0
    case 'profissional':
      return s.professionalChosen
    case 'horario':
      return s.startsAt !== null
    case 'confirmar':
      return false
  }
}

export function iniciarFluxo(i: {
  key: string
  modo: 'novo' | 'remarcar'
  pets: { id: string; bookable: boolean }[]
  petId?: string | null
  serviceIds?: string[]
  professionalId?: string | null
  singleProfessional?: boolean
}): FluxoEstado {
  const agendaveis = i.pets.filter((p) => p.bookable)
  const semPet = i.modo === 'novo' && agendaveis.length <= 1
  const pedido = i.petId && agendaveis.some((p) => p.id === i.petId) ? i.petId : null
  const remarcando = i.modo === 'remarcar'
  const petId = remarcando ? (i.petId ?? null) : (pedido ?? (semPet ? (agendaveis[0]?.id ?? null) : null))
  // Loja sem pets (nenhum cadastro) escolhe serviços sem pet; com pets, só depois de escolher o pet.
  const serviceIds = remarcando ? [...new Set(i.serviceIds ?? [])] : petId !== null || i.pets.length === 0 ? [...new Set(i.serviceIds ?? [])] : []
  const professionalChosen = i.modo === 'novo' ? serviceIds.length > 0 && i.professionalId !== undefined : i.professionalId !== undefined
  const semProfissional = i.singleProfessional === true && i.modo === 'novo'
  const passos = passosDe(i.modo, { semPet, semProfissional })
  const base = {
    petId,
    serviceIds,
    professionalChosen: i.modo === 'remarcar' ? professionalChosen : semProfissional ? serviceIds.length > 0 : professionalChosen,
    startsAt: null,
  }
  const primeiro = passos.find((p) => !completo(base, p)) ?? 'horario'
  return {
    modo: i.modo,
    passos,
    passo: primeiro,
    direction: 1,
    petId,
    serviceIds,
    professionalId: professionalChosen ? (i.professionalId ?? null) : null,
    professionalChosen: base.professionalChosen,
    date: null,
    startsAt: null,
    startsLabel: null,
    note: '',
    key: i.key,
    aviso: null,
    sugestoes: [],
    semProfissional,
    semPet,
  }
}

function recalcular(s: FluxoEstado, mudanca: Partial<FluxoEstado>): FluxoEstado {
  const n = { ...s, ...mudanca }
  const passos = passosDe(n.modo, n)
  return { ...n, passos, passo: passos.includes(n.passo) ? n.passo : (passos[passos.length - 1] ?? n.passo) }
}

const semHorario = (): Pick<FluxoEstado, 'startsAt' | 'startsLabel' | 'aviso' | 'sugestoes'> => ({ startsAt: null, startsLabel: null, aviso: null, sugestoes: [] })

export function fluxoReducer(s: FluxoEstado, a: FluxoAcao): FluxoEstado {
  switch (a.type) {
    case 'pet': {
      if (a.petId === s.petId) return s
      return recalcular(s, { petId: a.petId, serviceIds: [], professionalId: null, professionalChosen: false, semProfissional: false, date: null, ...semHorario() })
    }
    case 'servico': {
      const ja = s.serviceIds.includes(a.serviceId)
      const serviceIds = ja ? s.serviceIds.filter((id) => id !== a.serviceId) : [...s.serviceIds, a.serviceId]
      return recalcular(s, { serviceIds, professionalId: null, professionalChosen: false, semProfissional: false, ...semHorario() })
    }
    case 'profissional': {
      if (s.professionalChosen && a.id === s.professionalId) return s
      return { ...s, professionalId: a.id, professionalChosen: true, ...semHorario() }
    }
    case 'unico': {
      // Só um profissional faz tudo: escolhido sem perguntar, e o passo sai do caminho (ao voltar, pula-se por cima dele).
      const depois = s.passos[s.passos.indexOf('profissional') + 1]
      const n = recalcular(s, { professionalId: a.id, professionalChosen: true, semProfissional: true, ...semHorario() })
      return depois && s.passo === 'profissional' ? { ...n, passo: depois, direction: 1 } : n
    }
    case 'dia': {
      if (a.date === s.date) return s
      return { ...s, date: a.date, ...semHorario() }
    }
    case 'horario': {
      const doutroDia = s.sugestoes.find((x) => x.iso === a.iso)
      return { ...s, startsAt: a.iso, startsLabel: doutroDia?.label ?? a.label, ...(doutroDia ? { date: doutroDia.date } : {}), aviso: null, sugestoes: [] }
    }
    case 'nota':
      return { ...s, note: a.text }
    case 'avancar': {
      if (!podeAvancar(s)) return s
      const proximo = s.passos[s.passos.indexOf(s.passo) + 1]
      return proximo ? { ...s, passo: proximo, direction: 1 } : s
    }
    case 'voltar': {
      const anterior = s.passos[s.passos.indexOf(s.passo) - 1]
      return anterior ? { ...s, passo: anterior, direction: -1 } : s
    }
    case 'ir': {
      if (!s.passos.includes(a.passo)) return s
      return { ...s, passo: a.passo, direction: s.passos.indexOf(a.passo) >= s.passos.indexOf(s.passo) ? 1 : -1 }
    }
    case 'ocupado':
      return { ...s, passo: 'horario', direction: -1, startsAt: null, startsLabel: null, aviso: a.message, sugestoes: a.sugestoes }
  }
}

/** Chave nova de idempotência (1 a 80 caracteres `[A-Za-z0-9_-]`): UUID sem hífens. */
export function novaChave(): string {
  return crypto.randomUUID().replaceAll('-', '')
}
