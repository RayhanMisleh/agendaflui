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
  servicos: { nome: string; minutos: number; centavos: number; clube?: boolean }[]
  /** `papel` liga a ficha ao acesso de demonstração desse papel; `null` fica sem acesso. */
  profissionais: { nome: string; papel: 'gerente' | 'profissional' | null }[]
  comissaoBps: number
  expediente: DemoExpediente
  clientes: { nome: string; telefone: string; email?: string; notas?: string; clube?: boolean }[]
  /** Combinações de serviços (índices em `servicos`) que os agendamentos usam, em rodízio. */
  combinacoes: number[][]
}

const manha = { startMin: 480, endMin: 720 }
const AGENDA_PATAS: DemoAgenda = {
  servicos: [
    { nome: 'Banho', minutos: 60, centavos: 7000 },
    { nome: 'Tosa higiênica', minutos: 30, centavos: 4500 },
    { nome: 'Banho e tosa completa', minutos: 120, centavos: 14000 },
    { nome: 'Corte de unhas', minutos: 15, centavos: 2500 },
    { nome: 'Hidratação', minutos: 30, centavos: 5500, clube: true },
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
  combinacoes: [[0], [1], [2], [3], [0, 3], [1], [4], [0], [2], [1, 3], [0, 4], [3]],
}

const AGENDA_NAVALHA: DemoAgenda = {
  servicos: [
    { nome: 'Corte', minutos: 30, centavos: 5000 },
    { nome: 'Barba', minutos: 30, centavos: 4000 },
    { nome: 'Corte e barba', minutos: 60, centavos: 8000 },
    { nome: 'Sobrancelha', minutos: 15, centavos: 2000 },
    { nome: 'Pigmentação', minutos: 45, centavos: 9000 },
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
  combinacoes: [[0], [2], [1], [0, 3], [4], [0], [1, 3], [2], [0], [1], [4, 3], [2]],
}

export const DEMO_CONTAS = [
  {
    chave: 'patas',
    slug: 'patas-e-cia',
    nome: 'Patas & Cia',
    segmento: 'Pet shop',
    fuso: 'America/Sao_Paulo',
    marca: {
      primaryColor: '#2F6B4F',
      accentColor: '#E8833A',
      coverMaterial: 'LINEN',
      paperTone: 'CREAM',
      fontPair: 'FRIENDLY',
      loginMessage: 'Que bom ver você de volta. A agenda de banho e tosa está aberta.',
    },
    modulos: { loyalty: true, banners: true, store: false, vouchers: false },
    termos: {
      termProfessionalSingular: 'Tosador',
      termProfessionalPlural: 'Tosadores',
      termCustomerSingular: 'Tutor',
      termCustomerPlural: 'Tutores',
      termPointsSingular: 'Patinha',
      termPointsPlural: 'Patinhas',
    },
    equipe: {
      dono: 'Marina Duarte',
      gerente: 'Caio Ribeiro',
      profissional: 'Bia Nogueira',
    },
    agenda: AGENDA_PATAS,
  },
  {
    chave: 'navalha',
    slug: 'navalha-de-ouro',
    nome: 'Navalha de Ouro',
    segmento: 'Barbearia',
    fuso: 'America/Manaus',
    marca: {
      primaryColor: '#3A2A20',
      accentColor: '#C9A227',
      coverMaterial: 'LEATHER',
      paperTone: 'WHITE',
      fontPair: 'CLASSIC',
      loginMessage: 'Entre para abrir a agenda da casa.',
    },
    modulos: { loyalty: true, banners: true, store: true, vouchers: true },
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
  },
] as const

export const DEMO_MULTI_NOME = 'Helena Prado'
