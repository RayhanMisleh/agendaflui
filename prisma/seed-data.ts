/** Dados fixos das contas de demonstração. Sem importações: os testes e2e também leem este arquivo. */

export type DemoPapel = 'dono' | 'gerente' | 'profissional'

const DOMINIO = 'agendaflui.localhost'

/** Motivo do fechamento de demonstração: ele é gravado por último e marca a agenda como completa. */
export const DEMO_CLOSURE_REASON = 'Feriado (demonstração)'

/** E-mail de demonstração de cada papel numa conta ("patas" ou "navalha"). */
export function demoEmail(conta: 'patas' | 'navalha', papel: DemoPapel): string {
  return `${papel}.${conta}@${DOMINIO}`
}

type Faixa = { startMin: number; endMin: number }
export type DemoExpediente = Partial<
  Record<'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY', Faixa[]>
>

/** Agenda de demonstração de uma conta: o que o seed cria pelas funções de domínio. */
export type DemoAgenda = {
  servicos: { nome: string; minutos: number; centavos: number; pontos: number; clube?: boolean }[]
  /** `papel` liga a ficha ao acesso de demonstração desse papel; `null` fica sem acesso. */
  profissionais: { nome: string; papel: 'gerente' | 'profissional' | null }[]
  comissaoBps: number
  expediente: DemoExpediente
  clientes: { nome: string; telefone: string; email?: string; notas?: string; clube?: boolean }[]
  /** Cliente que a conta já arquivou: fica de fora da agenda e só aparece na lista de arquivados. */
  arquivado: { nome: string; telefone: string; notas: string }
  /** Combinações de serviços (índices em `servicos`) que os agendamentos usam, em rodízio. */
  combinacoes: number[][]
}

const manha = { startMin: 480, endMin: 720 }
const AGENDA_PATAS: DemoAgenda = {
  servicos: [
    { nome: 'Banho', minutos: 60, centavos: 7000, pontos: 10 },
    { nome: 'Tosa higiênica', minutos: 30, centavos: 4500, pontos: 5 },
    { nome: 'Banho e tosa completa', minutos: 120, centavos: 14000, pontos: 20 },
    { nome: 'Corte de unhas', minutos: 15, centavos: 2500, pontos: 3 },
    { nome: 'Hidratação', minutos: 30, centavos: 5500, pontos: 8, clube: true },
  ],
  profissionais: [
    { nome: 'Bia Nogueira', papel: 'profissional' },
    { nome: 'Caio Ribeiro', papel: 'gerente' },
    { nome: 'Renata Lopes', papel: null },
  ],
  comissaoBps: 4000,
  expediente: {
    MONDAY: [manha, { startMin: 780, endMin: 1080 }],
    TUESDAY: [manha, { startMin: 780, endMin: 1080 }],
    WEDNESDAY: [manha, { startMin: 780, endMin: 1080 }],
    THURSDAY: [manha, { startMin: 780, endMin: 1080 }],
    FRIDAY: [manha, { startMin: 780, endMin: 1080 }],
    SATURDAY: [{ startMin: 480, endMin: 780 }],
  },
  clientes: [
    { nome: 'Aline Moreira', telefone: '(11) 90000-0001', email: 'aline.moreira@agendaflui.localhost', notas: 'Thor, golden retriever, porte grande.' },
    { nome: 'Bruno Tavares', telefone: '(11) 90000-0002', notas: 'Mel, shih tzu. Não gosta do secador.' },
    { nome: 'Carla Fontes', telefone: '(11) 90000-0003', email: 'carla.fontes@agendaflui.localhost', notas: 'Pipoca, poodle toy.', clube: true },
    { nome: 'Diego Lacerda', telefone: '(11) 90000-0004', notas: 'Bolt, border collie.' },
    { nome: 'Eliane Prates', telefone: '(11) 90000-0005', notas: 'Luna e Nina, gatas persas.' },
    { nome: 'Fábio Cordeiro', telefone: '(11) 90000-0006', email: 'fabio.cordeiro@agendaflui.localhost', notas: 'Rex, pastor alemão.', clube: true },
    { nome: 'Gabriela Siqueira', telefone: '(11) 90000-0007', notas: 'Amora, yorkshire.' },
    { nome: 'Henrique Aragão', telefone: '(11) 90000-0008', notas: 'Bento, labrador.' },
    { nome: 'Isabela Quintana', telefone: '(11) 90000-0009', email: 'isabela.quintana@agendaflui.localhost', notas: 'Fiona, spitz alemão.' },
    { nome: 'João Pedro Salles', telefone: '(11) 90000-0010', notas: 'Tobias, beagle.' },
    { nome: 'Karina Bastos', telefone: '(11) 90000-0011', notas: 'Nina, maltês.', clube: true },
    { nome: 'Leandro Veloso', telefone: '(11) 90000-0012', email: 'leandro.veloso@agendaflui.localhost', notas: 'Zeca, bulldog francês.' },
  ],
  arquivado: { nome: 'Marcela Duarte', telefone: '(11) 90000-0013', notas: 'Mudou de cidade e pediu para sair da lista.' },
  combinacoes: [[0], [1], [2], [3], [0, 3], [1], [4], [0], [2], [1, 3], [0, 4], [3]],
}

const AGENDA_NAVALHA: DemoAgenda = {
  servicos: [
    { nome: 'Corte', minutos: 30, centavos: 5000, pontos: 10 },
    { nome: 'Barba', minutos: 30, centavos: 4000, pontos: 8 },
    { nome: 'Corte e barba', minutos: 60, centavos: 8000, pontos: 20 },
    { nome: 'Sobrancelha', minutos: 15, centavos: 2000, pontos: 5 },
    { nome: 'Pigmentação', minutos: 45, centavos: 9000, pontos: 15 },
  ],
  profissionais: [
    { nome: 'Davi Castro', papel: 'profissional' },
    { nome: 'Tiago Albuquerque', papel: 'gerente' },
    { nome: 'Wesley Pinto', papel: null },
  ],
  comissaoBps: 4500,
  expediente: {
    TUESDAY: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1200 }],
    WEDNESDAY: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1200 }],
    THURSDAY: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1200 }],
    FRIDAY: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1200 }],
    SATURDAY: [{ startMin: 540, endMin: 720 }, { startMin: 780, endMin: 1200 }],
  },
  clientes: [
    { nome: 'Adriano Peixoto', telefone: '(92) 90000-0001', email: 'adriano.peixoto@agendaflui.localhost' },
    { nome: 'Breno Matos', telefone: '(92) 90000-0002' },
    { nome: 'Cássio Mourão', telefone: '(92) 90000-0003', clube: true },
    { nome: 'Danilo Furtado', telefone: '(92) 90000-0004' },
    { nome: 'Elias Brandão', telefone: '(92) 90000-0005', email: 'elias.brandao@agendaflui.localhost' },
    { nome: 'Fernando Lacerda', telefone: '(92) 90000-0006', clube: true },
    { nome: 'Gustavo Rangel', telefone: '(92) 90000-0007' },
    { nome: 'Heitor Sampaio', telefone: '(92) 90000-0008', email: 'heitor.sampaio@agendaflui.localhost' },
    { nome: 'Igor Medeiros', telefone: '(92) 90000-0009' },
    { nome: 'Jonas Pacheco', telefone: '(92) 90000-0010', clube: true },
    { nome: 'Kleber Nunes', telefone: '(92) 90000-0011' },
    { nome: 'Lucas Amaral', telefone: '(92) 90000-0012', email: 'lucas.amaral@agendaflui.localhost' },
  ],
  arquivado: { nome: 'Nelson Ferraz', telefone: '(92) 90000-0013', notas: 'Parou de frequentar a casa.' },
  combinacoes: [[0], [2], [1], [0, 3], [4], [0], [1, 3], [2], [0], [1], [4, 3], [2]],
}

/** Módulos de demonstração de uma conta: o que o seed cria pelas funções de domínio (preços em centavos, datas em dias a partir de hoje). */
export type DemoModulos = {
  premios: { nome: string; descricao: string; pontos: number; estoque: number | null }[]
  /** Um banner por item; `inicio` e `fim` em dias a partir de hoje (`null` = sem limite). Todos ativos, com imagem. */
  banners: { titulo: string; link: string | null; inicio: number | null; fim: number | null }[]
  loja?: {
    categorias: string[]
    /** `categoria` é o índice em `categorias`. */
    produtos: { nome: string; descricao: string; categoria: number; centavos: number; promocaoCentavos?: number; estoque: number; gramas: number }[]
  }
}

const MODULOS_PATAS: DemoModulos = {
  premios: [
    { nome: 'Banho grátis', descricao: 'Um banho simples para o seu pet.', pontos: 150, estoque: null },
    { nome: 'Corte de unhas grátis', descricao: 'Corte de unhas na próxima visita.', pontos: 40, estoque: 20 },
  ],
  banners: [{ titulo: 'Semana do banho e tosa', link: null, inicio: null, fim: 30 }],
}

const MODULOS_NAVALHA: DemoModulos = {
  premios: [
    { nome: 'Pomada modeladora', descricao: 'Uma pomada para levar para casa.', pontos: 60, estoque: 10 },
    { nome: 'Corte grátis', descricao: 'Um corte na próxima visita.', pontos: 120, estoque: null },
    { nome: 'Barba grátis', descricao: 'Barba completa na próxima visita.', pontos: 90, estoque: 5 },
  ],
  banners: [
    { titulo: 'Combo corte e barba', link: '/servicos', inicio: null, fim: 30 },
    { titulo: 'Produtos para a barba', link: null, inicio: -3, fim: null },
    { titulo: 'Especial de fim de ano', link: null, inicio: 14, fim: 45 },
  ],
  loja: {
    categorias: ['Barba', 'Cabelo'],
    produtos: [
      { nome: 'Óleo para barba', descricao: 'Hidrata e dá brilho à barba.', categoria: 0, centavos: 4500, estoque: 12, gramas: 120 },
      { nome: 'Balm para barba', descricao: 'Modela e suaviza os fios.', categoria: 0, centavos: 3900, promocaoCentavos: 3200, estoque: 8, gramas: 100 },
      { nome: 'Pente de madeira', descricao: 'Pente de madeira para barba.', categoria: 0, centavos: 2500, estoque: 15, gramas: 60 },
      { nome: 'Pomada modeladora', descricao: 'Fixação forte e acabamento fosco.', categoria: 1, centavos: 4200, estoque: 10, gramas: 150 },
      { nome: 'Shampoo anticaspa', descricao: 'Limpeza profunda do couro cabeludo.', categoria: 1, centavos: 3500, estoque: 0, gramas: 300 },
    ],
  },
}

export const DEMO_CONTAS = [
  {
    chave: 'patas',
    slug: 'patas-e-cia',
    nome: 'Patas & Cia',
    segmento: 'Pet shop',
    fuso: 'America/Sao_Paulo',
    marca: {
      primaryColor: '#2F7D5B',
      accentColor: '#F29A4B',
      coverMaterial: 'LEATHER',
    },
    modulos: { loyalty: true, banners: true, store: false },
    termos: {
      termProfessionalSingular: 'Tosador',
      termProfessionalPlural: 'Tosadores',
      termCustomerSingular: 'Cliente',
      termCustomerPlural: 'Clientes',
      termPointsSingular: 'Patinha',
      termPointsPlural: 'Patinhas',
    },
    equipe: {
      dono: 'Marina Duarte',
      gerente: 'Caio Ribeiro',
      profissional: 'Bia Nogueira',
    },
    agenda: AGENDA_PATAS,
    moduloDados: MODULOS_PATAS,
  },
  {
    chave: 'navalha',
    slug: 'navalha-de-ouro',
    nome: 'Navalha de Ouro',
    segmento: 'Barbearia',
    fuso: 'America/Manaus',
    marca: {
      primaryColor: '#243B6B',
      accentColor: '#E3A72F',
      coverMaterial: 'WOOD',
    },
    modulos: { loyalty: true, banners: true, store: true },
    termos: {
      termProfessionalSingular: 'Barbeiro',
      termProfessionalPlural: 'Barbeiros',
    },
    equipe: {
      dono: 'Rafael Menezes',
      gerente: 'Tiago Albuquerque',
      profissional: 'Davi Castro',
    },
    agenda: AGENDA_NAVALHA,
    moduloDados: MODULOS_NAVALHA,
  },
] as const

/** Admin extra da plataforma, desativado: dá vida à lista de admins do painel dev. A senha dele é aleatória e descartada. */
export const DEMO_ADMIN_INATIVO = { nome: 'Admin Inativo', email: 'inativo@agendaflui.localhost' } as const

/** Conta de demonstração suspensa (criada ativa e suspensa só na primeira vez, para o admin poder reativá-la). */
export const DEMO_CONTA_SUSPENSA = {
  slug: 'estudio-sol-nascente',
  nome: 'Estúdio Sol Nascente',
  segmento: 'Estúdio de pilates',
  fuso: 'America/Sao_Paulo',
  donoNome: 'Helena Prado',
  donoEmail: `dono.sol@${DOMINIO}`,
} as const

/** Rotas do uso de API de demonstração: método e caminho como o código grava, peso do tráfego e tempo típico em ms. */
export const DEMO_ROTAS_USO = [
  { rota: 'GET /v1/availability', peso: 6, ms: 38 },
  { rota: 'GET /v1/appointments', peso: 4, ms: 52 },
  { rota: 'POST /v1/appointments', peso: 2, ms: 96 },
  { rota: 'GET /v1/business', peso: 3, ms: 21 },
  { rota: 'POST /v1/auth/customer/login', peso: 1, ms: 180 },
] as const

/** Execuções do agendador de demonstração: minutos antes do "agora", tipo, resultado (contagens ou nome do erro). */
export const DEMO_EXECUCOES = [
  { minutosAtras: 3, kind: 'notifications', resultado: { sent: 4, skipped: 1 } },
  { minutosAtras: 4, kind: 'usage_flush', resultado: 12 },
  { minutosAtras: 4, kind: 'notifications', resultado: { sent: 2 } },
  { minutosAtras: 5, kind: 'notifications', resultado: { sent: 1, retried: 1 } },
  { minutosAtras: 20, kind: 'cleanup', resultado: { limites: 6, codigos: 2, tokens: 3, execucoes: 0, passagens: 0 } },
  { minutosAtras: 21, kind: 'notifications', resultado: { sent: 3, failed: 1 } },
  { minutosAtras: 22, kind: 'usage_flush', resultado: 9 },
  { minutosAtras: 80, kind: 'notifications', resultado: { sent: 5 } },
  { minutosAtras: 81, kind: 'cleanup', falha: 'ConnectionError' },
  { minutosAtras: 140, kind: 'usage_flush', resultado: 14 },
] as const
