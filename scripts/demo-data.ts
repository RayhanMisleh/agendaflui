/**
 * Dados fixos e planejamento puro (sem banco, sem relógio) da conta de demonstração do comando `npm run demo:create`.
 * Tudo é fictício: nomes, telefones e pets. Datas entram como parâmetro (nunca `new Date()` aqui).
 */
import type { PetCoat, PetSize, PetSpecies, PriceVariant } from '../src/server/db/generated/client'
import { NICHES, variantOfPet } from '../src/server/niches'
import type { ServiceIconName } from '../src/shared/service-icons'
import { DEMO_MARCA } from './demo-brand'
import { addDays, minuteToInstant, weekdayOf, WEEKDAYS, type Weekday } from '../src/server/time'

export const DEMO_SLUG = 'demo'
export const DEMO_NOME = DEMO_MARCA.nome
export const DEMO_EMAIL_DONO = 'demo@agendaflui.com.br'
export const DEMO_EMAIL_CLIENTE_TESTE = 'cliente.teste@agendaflui.com.br'
const DOMINIO_EQUIPE = 'demo.agendaflui.com.br'
const DOMINIO_CLIENTES = 'clientes.demo.agendaflui.com.br'

export const demoEmailEquipe = (apelido: string): string => `${apelido}@${DOMINIO_EQUIPE}`
/** O e-mail de um cliente de demonstração com conta (o de teste usa `DEMO_EMAIL_CLIENTE_TESTE`). */
export const demoEmailCliente = (apelido: string): string => `${apelido}@${DOMINIO_CLIENTES}`

export const DEMO_DONO_NOME = 'Dono Demonstração'
export const DEMO_GERENTE = { nome: 'Patrícia Lima', email: demoEmailEquipe('gerente') } as const

type Faixa = { startMin: number; endMin: number }
export type Expediente = Partial<Record<Weekday, Faixa[]>>

const manha = { startMin: 480, endMin: 720 }
const tarde = { startMin: 810, endMin: 1080 }

type PrecoDeVariante = { priceCents: number; durationMin: number }
export type DemoServico = {
  nome: string
  descricao: string | null
  icone: ServiceIconName
  /** Preço e tempo por porte (`BY_VARIANT`); `null` = preço único, em `unico`. */
  porVariante: Partial<Record<PriceVariant, PrecoDeVariante>> | null
  unico?: PrecoDeVariante
  pontos: number
  clube?: boolean
}

/** Pontos de fidelidade: um por R$ 5,00 do preço (do porte médio, nos serviços por porte). */
const pontosDe = (centavos: number): number => Math.round(centavos / 100 / 5)

const SUGESTOES: DemoServico[] = NICHES.PET.serviceSuggestions.map((s) => ({
  nome: s.name,
  descricao: s.description,
  icone: s.icon,
  porVariante: { ...s.prices },
  pontos: pontosDe(s.prices.DOG_MEDIUM.priceCents),
}))

/** 0 Banho, 1 Banho e tosa, 2 Tosa higiênica, 3 Hidratação, 4 Corte de unha, 5 Limpeza de ouvidos, 6 Spa relaxante. */
export const DEMO_SERVICOS: DemoServico[] = [
  ...SUGESTOES,
  { nome: 'Limpeza de ouvidos', descricao: null, icone: 'heart', porVariante: null, unico: { priceCents: 3000, durationMin: 15 }, pontos: pontosDe(3000) },
  {
    nome: 'Spa relaxante',
    descricao: 'Banho, massagem e hidratação. Exclusivo do clube.',
    icone: 'flower',
    // Só cães: o gato não tem linha neste serviço.
    porVariante: {
      DOG_SMALL: { priceCents: 9000, durationMin: 60 },
      DOG_MEDIUM: { priceCents: 11000, durationMin: 75 },
      DOG_LARGE: { priceCents: 14000, durationMin: 90 },
      DOG_GIANT: { priceCents: 18000, durationMin: 105 },
    },
    pontos: pontosDe(11000),
    clube: true,
  },
]
export const SERVICO_SPA = 6

/** Preço e tempo do serviço para o porte, ou `null` se o serviço não é feito para ele. */
export function precoDoServico(s: DemoServico, variante: PriceVariant): PrecoDeVariante | null {
  if (s.porVariante === null) return s.unico ?? null
  return s.porVariante[variante] ?? null
}

/** O serviço é feito para esse porte e, se for do clube, o cliente é do clube. */
export function servicoOferecido(indice: number, variante: PriceVariant, clube: boolean): boolean {
  const s = DEMO_SERVICOS[indice]
  return s !== undefined && precoDoServico(s, variante) !== null && (s.clube !== true || clube)
}

export type DemoProfissional = {
  nome: string
  apelido: string
  bio: string
  comissaoBps: number
  /** Índices em `DEMO_SERVICOS`. */
  servicos: number[]
  expediente: Expediente
  /** Combinações de serviços (índices) que ele costuma atender. */
  combinacoes: number[][]
}

export const DEMO_PROFISSIONAIS: DemoProfissional[] = [
  {
    nome: 'Bia Nogueira',
    apelido: 'bia',
    bio: 'Cuida de banho e tosa há 9 anos, com jeito para pelo longo.',
    comissaoBps: 4000,
    servicos: [0, 1, 2, 3, 4, 5, 6],
    expediente: {
      MONDAY: [manha, tarde],
      TUESDAY: [manha, tarde],
      WEDNESDAY: [manha, tarde],
      THURSDAY: [manha, tarde],
      FRIDAY: [manha, tarde],
      SATURDAY: [{ startMin: 480, endMin: 780 }],
    },
    combinacoes: [[1], [1], [0], [2], [3], [1, 3], [0, 4], [2, 4], [6], [0, 3]],
  },
  {
    nome: 'Caio Ribeiro',
    apelido: 'caio',
    bio: 'Cuida do banho dos mais agitados com muita paciência.',
    comissaoBps: 3500,
    servicos: [0, 1, 3, 4, 5, 6],
    expediente: {
      TUESDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      WEDNESDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      THURSDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      FRIDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      SATURDAY: [{ startMin: 540, endMin: 840 }],
    },
    combinacoes: [[0], [0], [1], [0, 4], [3], [0, 5], [1, 4], [6], [4]],
  },
  {
    nome: 'Renata Lopes',
    apelido: 'renata',
    bio: 'Cuida de tosa e estética, e adora gatos e filhotes.',
    comissaoBps: 4500,
    servicos: [0, 1, 2, 4, 5],
    expediente: {
      MONDAY: [manha, { startMin: 810, endMin: 1020 }],
      WEDNESDAY: [manha, { startMin: 810, endMin: 1020 }],
      THURSDAY: [manha, { startMin: 810, endMin: 1020 }],
      FRIDAY: [manha, { startMin: 810, endMin: 1020 }],
      SATURDAY: [{ startMin: 480, endMin: 780 }],
    },
    combinacoes: [[0], [2], [1], [0, 4], [2, 5], [1, 4], [4]],
  },
]

export type DemoPet = {
  nome: string
  especie: PetSpecies
  /** Só cães têm porte. */
  porte: PetSize | null
  raca: string
  pelagem: PetCoat
  cuidados?: string
}

export type DemoCliente = {
  nome: string
  /** Vira o e-mail `<apelido>@clientes.demo...` de quem tem conta; clientes de balcão não têm pessoa. */
  apelido: string
  /** `true` = cliente com conta (ligado a uma pessoa); `false` = cliente de balcão. */
  conta: boolean
  /** O cliente de teste: e-mail fixo e senha gerada e mostrada uma vez, só no terminal. */
  teste?: boolean
  clube?: boolean
  pets: DemoPet[]
}

/** 14 clientes: 8 com conta (o de teste entre eles) e 6 de balcão; cães dos quatro portes e 3 gatos. */
export const DEMO_CLIENTES: DemoCliente[] = [
  { nome: 'Aline Moreira', apelido: 'aline', conta: true, clube: true, pets: [{ nome: 'Thor', especie: 'DOG', porte: 'LARGE', raca: 'Golden retriever', pelagem: 'LONG' }] },
  { nome: 'Bruno Tavares', apelido: 'bruno', conta: true, pets: [{ nome: 'Mel', especie: 'DOG', porte: 'SMALL', raca: 'Shih tzu', pelagem: 'LONG', cuidados: 'Medo de secador' }] },
  { nome: 'Carla Fontes', apelido: 'carla', conta: false, clube: true, pets: [{ nome: 'Pipoca', especie: 'DOG', porte: 'SMALL', raca: 'Poodle toy', pelagem: 'MEDIUM' }] },
  { nome: 'Diego Lacerda', apelido: 'diego', conta: true, pets: [{ nome: 'Bolt', especie: 'DOG', porte: 'MEDIUM', raca: 'Border collie', pelagem: 'MEDIUM' }] },
  {
    nome: 'Eliane Prates',
    apelido: 'eliane',
    conta: true,
    pets: [
      { nome: 'Luna', especie: 'CAT', porte: null, raca: 'Persa', pelagem: 'LONG' },
      { nome: 'Pérola', especie: 'CAT', porte: null, raca: 'Ragdoll', pelagem: 'LONG', cuidados: 'Idosa' },
    ],
  },
  { nome: 'Fábio Cordeiro', apelido: 'fabio', conta: false, pets: [{ nome: 'Rex', especie: 'DOG', porte: 'LARGE', raca: 'Pastor alemão', pelagem: 'MEDIUM' }] },
  { nome: 'Gabriela Siqueira', apelido: 'gabriela', conta: true, clube: true, pets: [{ nome: 'Amora', especie: 'DOG', porte: 'SMALL', raca: 'Yorkshire', pelagem: 'LONG' }] },
  { nome: 'Henrique Aragão', apelido: 'henrique', conta: false, pets: [{ nome: 'Duque', especie: 'DOG', porte: 'GIANT', raca: 'Rottweiler', pelagem: 'SHORT', cuidados: 'Dócil, mas desconfia de estranhos' }] },
  {
    nome: 'Isabela Quintana',
    apelido: 'isabela',
    conta: true,
    pets: [
      { nome: 'Fiona', especie: 'DOG', porte: 'SMALL', raca: 'Spitz alemão', pelagem: 'LONG' },
      { nome: 'Tobias', especie: 'DOG', porte: 'MEDIUM', raca: 'Beagle', pelagem: 'SHORT' },
    ],
  },
  { nome: 'João Pedro Salles', apelido: 'joao', conta: false, pets: [{ nome: 'Zeca', especie: 'DOG', porte: 'MEDIUM', raca: 'Bulldog francês', pelagem: 'SHORT' }] },
  { nome: 'Karina Bastos', apelido: 'karina', conta: false, clube: true, pets: [{ nome: 'Nina', especie: 'DOG', porte: 'SMALL', raca: 'Maltês', pelagem: 'LONG', cuidados: 'Idosa' }] },
  { nome: 'Leandro Veloso', apelido: 'leandro', conta: true, pets: [{ nome: 'Simba', especie: 'DOG', porte: 'LARGE', raca: 'Chow chow', pelagem: 'LONG', cuidados: 'Tosa só na tesoura' }] },
  { nome: 'Mariana Teixeira', apelido: 'mariana', conta: false, pets: [{ nome: 'Princesa', especie: 'DOG', porte: 'SMALL', raca: 'Lhasa apso', pelagem: 'LONG', cuidados: 'Alergia a perfume forte' }] },
  {
    nome: 'Camila Teste',
    apelido: 'camila',
    conta: true,
    teste: true,
    pets: [
      { nome: 'Chico', especie: 'DOG', porte: 'MEDIUM', raca: 'Vira-lata caramelo', pelagem: 'SHORT' },
      { nome: 'Mingau', especie: 'CAT', porte: null, raca: 'Siamês', pelagem: 'SHORT' },
    ],
  },
]

/** O e-mail da pessoa de um cliente com conta. */
export function emailDoCliente(c: DemoCliente): string {
  return c.teste === true ? DEMO_EMAIL_CLIENTE_TESTE : demoEmailCliente(c.apelido)
}

/** O porte de preço de cada pet do cliente, na ordem de `pets`. */
export const variantesDoCliente = (c: DemoCliente): PriceVariant[] => c.pets.map((p) => variantOfPet({ species: p.especie, size: p.porte }))

export const DEMO_PREMIOS = [
  { nome: 'Petisco natural', descricao: 'Um saquinho de petisco natural para o seu pet.', pontos: 40, estoque: 50 },
  { nome: 'Corte de unhas grátis', descricao: 'Corte de unhas na próxima visita.', pontos: 60, estoque: null },
  { nome: 'Hidratação grátis', descricao: 'Hidratação de pelagem na próxima visita.', pontos: 120, estoque: null },
  { nome: 'Banho grátis (porte pequeno)', descricao: 'Um banho para cães de porte pequeno.', pontos: 150, estoque: null },
  { nome: 'Kit de brinquedos', descricao: 'Bolinha, corda e mordedor.', pontos: 300, estoque: 5 },
  { nome: 'Caminha pet', descricao: 'Caminha macia tamanho M.', pontos: 500, estoque: 3 },
] as const

/** `inicio` e `fim` em dias a partir de hoje (`null` = sem limite). */
/** Os dois primeiros não vencem, para a conta sempre ter banner no ar; os outros mostram agendado e encerrado. */
export const DEMO_BANNERS = [
  { titulo: 'Semana do banho e tosa', link: null, inicio: null, fim: null, cor: '#2F7D5B' },
  { titulo: 'Ração premium com desconto', link: null, inicio: -5, fim: null, cor: '#F29A4B' },
  { titulo: 'Hotelzinho para as festas', link: null, inicio: 7, fim: 30, cor: '#4A6FA5' },
  { titulo: 'Campanha de vacinação', link: null, inicio: -30, fim: -3, cor: '#8E5A9B' },
] as const

export const DEMO_CATEGORIAS = ['Rações', 'Petiscos', 'Brinquedos', 'Higiene', 'Acessórios'] as const

export const DEMO_PRODUTOS: {
  nome: string
  descricao: string
  categoria: number
  centavos: number
  promocao?: number
  estoque: number
  gramas: number
  cor: string
}[] = [
  { nome: 'Ração premium cães adultos 15 kg', descricao: 'Alimento completo para cães adultos de todas as raças.', categoria: 0, centavos: 18990, promocao: 16990, estoque: 25, gramas: 15000, cor: '#C8803A' },
  { nome: 'Ração premium gatos castrados 10 kg', descricao: 'Controle de peso e saúde urinária.', categoria: 0, centavos: 15900, estoque: 18, gramas: 10000, cor: '#B5651D' },
  { nome: 'Ração filhotes 3 kg', descricao: 'Mais proteína para crescer forte.', categoria: 0, centavos: 6490, estoque: 30, gramas: 3000, cor: '#D9A05B' },
  { nome: 'Bifinho de carne 500 g', descricao: 'Petisco macio, sem corantes.', categoria: 1, centavos: 2490, estoque: 60, gramas: 500, cor: '#8B4A2B' },
  { nome: 'Osso natural', descricao: 'Osso bovino para roer, dura bastante.', categoria: 1, centavos: 1490, estoque: 40, gramas: 200, cor: '#E8D9B5' },
  { nome: 'Petisco dental com 7 unidades', descricao: 'Ajuda a limpar os dentes e refresca o hálito.', categoria: 1, centavos: 1990, promocao: 1690, estoque: 35, gramas: 180, cor: '#6BAF92' },
  { nome: 'Bolinha de borracha', descricao: 'Resistente, quica bastante.', categoria: 2, centavos: 1290, estoque: 80, gramas: 80, cor: '#E0533D' },
  { nome: 'Corda com nós', descricao: 'Para brincar de cabo de guerra.', categoria: 2, centavos: 1890, estoque: 45, gramas: 150, cor: '#3D7BE0' },
  { nome: 'Arranhador torre para gatos', descricao: 'Três andares com sisal.', categoria: 2, centavos: 12990, estoque: 6, gramas: 4500, cor: '#A89F91' },
  { nome: 'Pelúcia mordedor', descricao: 'Pelúcia com apito.', categoria: 2, centavos: 2790, estoque: 0, gramas: 120, cor: '#E07BB0' },
  { nome: 'Shampoo neutro 500 ml', descricao: 'Para uso frequente, pH balanceado.', categoria: 3, centavos: 2990, estoque: 40, gramas: 550, cor: '#5BB5D9' },
  { nome: 'Condicionador pelos longos 500 ml', descricao: 'Desembaraça e deixa macio.', categoria: 3, centavos: 3290, estoque: 22, gramas: 550, cor: '#9B7BD9' },
  { nome: 'Tapete higiênico com 30 unidades', descricao: 'Super absorvente.', categoria: 3, centavos: 7490, promocao: 6490, estoque: 15, gramas: 1800, cor: '#7FC4A0' },
  { nome: 'Colônia pet 120 ml', descricao: 'Perfume suave, dermatologicamente testado.', categoria: 3, centavos: 2190, estoque: 2, gramas: 160, cor: '#D9B0E0' },
  { nome: 'Coleira ajustável M', descricao: 'Nylon reforçado com fecho de segurança.', categoria: 4, centavos: 3490, estoque: 28, gramas: 90, cor: '#2F7D5B' },
  { nome: 'Peitoral com guia', descricao: 'Conforto no passeio, evita puxões.', categoria: 4, centavos: 5990, estoque: 14, gramas: 300, cor: '#E0A03D' },
  { nome: 'Comedouro inox', descricao: 'Base antiderrapante.', categoria: 4, centavos: 2690, estoque: 33, gramas: 250, cor: '#B8C2CC' },
  { nome: 'Caminha pet M', descricao: 'Macia e lavável.', categoria: 4, centavos: 11990, estoque: 8, gramas: 1500, cor: '#7B8FD9' },
  { nome: 'Shampoo antipulgas 500 ml', descricao: 'Uso só em cães, conforme a bula.', categoria: 3, centavos: 3890, estoque: 20, gramas: 550, cor: '#D95B5B' },
]

/** Dia (em relação a hoje, negativo = passado), hora do dia em minutos, cliente, itens e desfecho. */
export type DemoPedido = {
  diasAtras: number
  minuto: number
  cliente: number
  /** `produto` é o índice em `DEMO_PRODUTOS`. */
  linhas: { produto: number; qtd: number }[]
  fim: 'entregue' | 'pronto' | 'pago' | 'cancelado_pago' | 'cancelado'
}

export const DEMO_PEDIDOS: DemoPedido[] = [
  { diasAtras: 27, minuto: 620, cliente: 0, linhas: [{ produto: 0, qtd: 1 }, { produto: 3, qtd: 2 }], fim: 'entregue' },
  { diasAtras: 25, minuto: 700, cliente: 6, linhas: [{ produto: 1, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 24, minuto: 905, cliente: 13, linhas: [{ produto: 6, qtd: 2 }, { produto: 7, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 20, minuto: 780, cliente: 3, linhas: [{ produto: 10, qtd: 1 }, { produto: 11, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 19, minuto: 990, cliente: 1, linhas: [{ produto: 14, qtd: 1 }, { produto: 15, qtd: 1 }], fim: 'cancelado_pago' },
  { diasAtras: 17, minuto: 600, cliente: 1, linhas: [{ produto: 2, qtd: 2 }], fim: 'entregue' },
  { diasAtras: 15, minuto: 840, cliente: 6, linhas: [{ produto: 12, qtd: 1 }], fim: 'cancelado' },
  { diasAtras: 12, minuto: 930, cliente: 0, linhas: [{ produto: 17, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 10, minuto: 660, cliente: 4, linhas: [{ produto: 0, qtd: 1 }, { produto: 5, qtd: 3 }], fim: 'entregue' },
  { diasAtras: 7, minuto: 870, cliente: 11, linhas: [{ produto: 8, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 6, minuto: 615, cliente: 13, linhas: [{ produto: 3, qtd: 1 }, { produto: 4, qtd: 2 }], fim: 'entregue' },
  { diasAtras: 4, minuto: 960, cliente: 1, linhas: [{ produto: 16, qtd: 2 }, { produto: 18, qtd: 1 }], fim: 'pronto' },
  { diasAtras: 3, minuto: 690, cliente: 0, linhas: [{ produto: 1, qtd: 1 }, { produto: 10, qtd: 1 }], fim: 'pronto' },
  { diasAtras: 2, minuto: 800, cliente: 11, linhas: [{ produto: 13, qtd: 1 }], fim: 'pago' },
  { diasAtras: 1, minuto: 645, cliente: 3, linhas: [{ produto: 0, qtd: 1 }], fim: 'pago' },
  { diasAtras: 1, minuto: 1010, cliente: 3, linhas: [{ produto: 6, qtd: 3 }], fim: 'cancelado' },
]

/** Resgates de prêmios, em ordem cronológica: índice do prêmio em `DEMO_PREMIOS`, dias atrás e situação final. */
export const DEMO_RESGATES: { premio: number; diasAtras: number; fim: 'entregue' | 'pendente' | 'cancelado' }[] = [
  { premio: 1, diasAtras: 20, fim: 'entregue' },
  { premio: 3, diasAtras: 16, fim: 'entregue' },
  { premio: 0, diasAtras: 13, fim: 'entregue' },
  { premio: 2, diasAtras: 9, fim: 'entregue' },
  { premio: 0, diasAtras: 6, fim: 'cancelado' },
  { premio: 4, diasAtras: 4, fim: 'pendente' },
  { premio: 3, diasAtras: 2, fim: 'pendente' },
  { premio: 1, diasAtras: 1, fim: 'entregue' },
]

// ---- Planejamento da agenda ------------------------------------------------------------------------------------

const GRADE_MIN = 15
export const DIAS_PASSADO = 28
export const DIAS_FUTURO = 14

/** Gerador pseudoaleatório determinístico (mulberry32): o mesmo `semente` gera sempre a mesma agenda. */
export function sorteador(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Marcacao = {
  /** Posição estável na agenda: serve para conferir, numa nova rodada, o que já foi criado. */
  profissional: number
  data: string
  minuto: number
  fim: number
  startsAt: Date
  endsAt: Date
  servicos: number[]
  cliente: number
  /** Qual dos pets do cliente (posição em `pets`). */
  pet: number
  /** Sorteio de 0 a 1 que decide o desfecho de uma marcação já passada. */
  sorteio: number
}

export type EntradaDoPlano = {
  /** Data local (AAAA-MM-DD) da primeira rodada: a agenda começa em `ancora - 28`. */
  ancora: string
  /** Último dia planejado (data local, inclusive), normalmente hoje + 14. Estender `ate` só acrescenta dias ao fim do plano. */
  ate: string
  fuso: string
  /** Datas sem expediente (fechamentos). */
  fechados: readonly string[]
  /** Horários já bloqueados ou reservados (por profissional e data): nada é marcado neles. */
  bloqueios: readonly { profissional: number; data: string; startMin: number; endMin: number }[]
  /** Por cliente: se é do clube e o porte de preço de cada pet. */
  clientes: readonly { clube: boolean; variantes: readonly PriceVariant[] }[]
}

type Intervalo = { startMin: number; endMin: number }
const sobrepoe = (a: Intervalo, b: Intervalo) => a.startMin < b.endMin && b.startMin < a.endMin

/** O dia do encaixe da demonstração: o primeiro dia útil (segunda a sexta, aberto) depois da âncora. */
export function diaDoEncaixe(ancora: string, fechados: readonly string[]): string {
  for (let delta = 1; ; delta += 1) {
    const data = addDays(ancora, delta)
    const dia = weekdayOf(data)
    if (dia !== 'SATURDAY' && dia !== 'SUNDAY' && !fechados.includes(data)) return data
  }
}

/** A janela da Bia nesse dia (10:00 às 12:00) fica livre no plano: nela a demonstração põe o atendimento normal e o encaixe. */
export const JANELA_DO_ENCAIXE = { profissional: 0, startMin: 600, endMin: 720 } as const

/**
 * Distribui as marcações de `ancora - 28` até `ate` (a sequência é determinística e só cresce no fim), em rodízio de profissionais e de clientes (alguns
 * clientes voltam bem mais que outros), sem sobrepor horários de um profissional, de um cliente nem bloqueios. O pet é
 * sorteado entre os do cliente e só entram serviços oferecidos ao porte dele (e ao clube, quando o serviço é do clube).
 */
export function planejarAgenda(e: EntradaDoPlano): Marcacao[] {
  const sorteio = sorteador(20261123)
  const total = e.clientes.length
  const ocupadoProf = new Map<string, Intervalo[]>()
  const ocupadoCliente = new Map<string, Intervalo[]>()
  for (const b of e.bloqueios) {
    const chave = `${b.profissional}|${b.data}`
    ocupadoProf.set(chave, [...(ocupadoProf.get(chave) ?? []), { startMin: b.startMin, endMin: b.endMin }])
  }
  const marcacoes: Marcacao[] = []
  for (let delta = -DIAS_PASSADO; ; delta += 1) {
    const data = addDays(e.ancora, delta)
    if (data > e.ate) break
    if (e.fechados.includes(data)) continue
    const dia = weekdayOf(data)
    if (!WEEKDAYS.includes(dia)) continue
    // Mais movimento no passado e mais folga nas últimas semanas do futuro.
    // Os 14 primeiros dias depois da âncora (o futuro da primeira rodada) têm a chance de sempre: o plano antigo não muda.
    const chance = delta < 0 ? 0.52 : delta <= DIAS_FUTURO ? Math.max(0.2, 0.5 - delta * 0.02) : 0.4
    for (const [p, prof] of DEMO_PROFISSIONAIS.entries()) {
      const faixas = prof.expediente[dia] ?? []
      const ja = ocupadoProf.get(`${p}|${data}`) ?? []
      for (const faixa of faixas) {
        let cursor = Math.ceil(faixa.startMin / GRADE_MIN) * GRADE_MIN
        while (cursor < faixa.endMin) {
          if (sorteio() > chance) {
            cursor += GRADE_MIN * (1 + Math.floor(sorteio() * 3))
            continue
          }
          // Cliente com preferência: o expoente concentra as visitas nos primeiros da lista.
          const cliente = Math.floor(sorteio() ** 1.5 * total)
          const perfil = e.clientes[cliente]
          const pet = Math.floor(sorteio() * (perfil?.variantes.length ?? 1))
          const variante = perfil?.variantes[pet] ?? 'DOG_MEDIUM'
          const clube = perfil?.clube === true
          const sugerida = prof.combinacoes[Math.floor(sorteio() * prof.combinacoes.length)] ?? [0]
          let combinacao = sugerida.filter((n) => servicoOferecido(n, variante, clube))
          if (combinacao.length === 0) {
            const alternativa = prof.servicos.find((n) => servicoOferecido(n, variante, clube))
            combinacao = alternativa === undefined ? [] : [alternativa]
          }
          const minutos = combinacao.reduce((soma, n) => {
            const s = DEMO_SERVICOS[n]
            return soma + ((s && precoDoServico(s, variante)?.durationMin) ?? 0)
          }, 0)
          if (combinacao.length === 0 || minutos === 0) {
            cursor += GRADE_MIN
            continue
          }
          const intervalo = { startMin: cursor, endMin: cursor + minutos }
          const chaveCliente = `${cliente}|${data}`
          const conflito =
            intervalo.endMin > faixa.endMin ||
            ja.some((o) => sobrepoe(o, intervalo)) ||
            (ocupadoCliente.get(chaveCliente) ?? []).some((o) => sobrepoe(o, intervalo))
          if (conflito) {
            cursor += GRADE_MIN
            continue
          }
          ja.push(intervalo)
          ocupadoCliente.set(chaveCliente, [...(ocupadoCliente.get(chaveCliente) ?? []), intervalo])
          marcacoes.push({
            profissional: p,
            data,
            minuto: intervalo.startMin,
            fim: intervalo.endMin,
            startsAt: minuteToInstant(data, intervalo.startMin, e.fuso),
            endsAt: minuteToInstant(data, intervalo.endMin, e.fuso),
            servicos: combinacao,
            cliente,
            pet,
            sorteio: sorteio(),
          })
          cursor = intervalo.endMin + GRADE_MIN * Math.floor(sorteio() * 3)
        }
      }
      ocupadoProf.set(`${p}|${data}`, ja)
    }
  }
  return marcacoes.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.profissional - b.profissional)
}

export type Desfecho = 'concluir' | 'faltar' | 'cancelar' | 'confirmar'

/** O que acontece com a marcação, dado o "agora": as que já terminaram viram concluídas, faltas ou cancelamentos. */
export function desfechoDe(m: Pick<Marcacao, 'sorteio' | 'endsAt'>, agora: Date): Desfecho {
  if (m.endsAt.getTime() <= agora.getTime()) return m.sorteio < 0.8 ? 'concluir' : m.sorteio < 0.9 ? 'cancelar' : 'faltar'
  return m.sorteio < 0.07 ? 'cancelar' : 'confirmar'
}
