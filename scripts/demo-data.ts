/**
 * Dados fixos e planejamento puro (sem banco, sem relógio) da conta de demonstração do comando `npm run demo:create`.
 * Tudo é fictício: nomes, telefones e pets. Datas entram como parâmetro (nunca `new Date()` aqui).
 */
import { addDays, minuteToInstant, weekdayOf, WEEKDAYS, type Weekday } from '../src/server/time'

export const DEMO_SLUG = 'demo'
export const DEMO_NOME = 'Pet Shop Demonstração'
export const DEMO_EMAIL_DONO = 'demo@agendaflui.com.br'
const DOMINIO_EQUIPE = 'demo.agendaflui.com.br'

export const demoEmailEquipe = (apelido: string): string => `${apelido}@${DOMINIO_EQUIPE}`

export const DEMO_DONO_NOME = 'Dono Demonstração'
export const DEMO_GERENTE = { nome: 'Patrícia Lima', email: demoEmailEquipe('gerente') } as const

type Faixa = { startMin: number; endMin: number }
export type Expediente = Partial<Record<Weekday, Faixa[]>>

const manha = { startMin: 480, endMin: 720 }
const tarde = { startMin: 810, endMin: 1080 }

export const DEMO_SERVICOS = [
  { nome: 'Banho porte pequeno', descricao: 'Banho com shampoo neutro, secagem e perfume.', minutos: 45, centavos: 5000, pontos: 10 },
  { nome: 'Banho porte médio', descricao: 'Banho com shampoo neutro, secagem e perfume.', minutos: 60, centavos: 7000, pontos: 14 },
  { nome: 'Banho porte grande', descricao: 'Banho com shampoo neutro, secagem e perfume.', minutos: 75, centavos: 9500, pontos: 19 },
  { nome: 'Tosa higiênica', descricao: 'Pelos das patas, barriga e região íntima.', minutos: 30, centavos: 4500, pontos: 9 },
  { nome: 'Tosa completa', descricao: 'Tosa na máquina ou na tesoura, conforme a raça.', minutos: 60, centavos: 8500, pontos: 17 },
  { nome: 'Banho e tosa', descricao: 'Banho completo e tosa da raça.', minutos: 90, centavos: 12000, pontos: 24 },
  { nome: 'Hidratação de pelagem', descricao: 'Máscara de hidratação para pelos macios.', minutos: 30, centavos: 5500, pontos: 11 },
  { nome: 'Corte de unhas', descricao: null, minutos: 15, centavos: 2500, pontos: 5 },
  { nome: 'Limpeza de ouvidos', descricao: null, minutos: 15, centavos: 3000, pontos: 6 },
  { nome: 'Spa relaxante', descricao: 'Banho, massagem e hidratação. Exclusivo do clube.', minutos: 45, centavos: 11000, pontos: 22, clube: true },
] as const

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
    bio: 'Tosadora há 9 anos, especialista em raças de pelo longo.',
    comissaoBps: 4000,
    servicos: [1, 2, 3, 4, 5, 6, 7, 9],
    expediente: {
      MONDAY: [manha, tarde],
      TUESDAY: [manha, tarde],
      WEDNESDAY: [manha, tarde],
      THURSDAY: [manha, tarde],
      FRIDAY: [manha, tarde],
      SATURDAY: [{ startMin: 480, endMin: 780 }],
    },
    combinacoes: [[1], [2], [3], [4], [5], [1, 7], [2, 6], [4, 7], [3, 7], [5], [9]],
  },
  {
    nome: 'Caio Ribeiro',
    apelido: 'caio',
    bio: 'Banhista, cuida dos mais agitados com muita paciência.',
    comissaoBps: 3500,
    servicos: [0, 1, 2, 6, 7, 8, 9],
    expediente: {
      TUESDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      WEDNESDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      THURSDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      FRIDAY: [{ startMin: 540, endMin: 720 }, { startMin: 810, endMin: 1140 }],
      SATURDAY: [{ startMin: 540, endMin: 840 }],
    },
    combinacoes: [[0], [1], [2], [0, 7], [1, 8], [6], [2, 6], [1, 7, 8], [9]],
  },
  {
    nome: 'Renata Lopes',
    apelido: 'renata',
    bio: 'Tosadora e esteticista pet, adora gatos e filhotes.',
    comissaoBps: 4500,
    servicos: [0, 3, 4, 5, 7, 8],
    expediente: {
      MONDAY: [manha, { startMin: 810, endMin: 1020 }],
      WEDNESDAY: [manha, { startMin: 810, endMin: 1020 }],
      THURSDAY: [manha, { startMin: 810, endMin: 1020 }],
      FRIDAY: [manha, { startMin: 810, endMin: 1020 }],
      SATURDAY: [{ startMin: 480, endMin: 780 }],
    },
    combinacoes: [[0], [3], [4], [5], [0, 7], [3, 8], [5, 7]],
  },
]

/** Cliente, pet e se é do clube. */
export const DEMO_CLIENTES: { nome: string; pet: string; clube?: boolean }[] = [
  { nome: 'Aline Moreira', pet: 'Thor, golden retriever, porte grande.', clube: true },
  { nome: 'Bruno Tavares', pet: 'Mel, shih tzu. Não gosta do secador.' },
  { nome: 'Carla Fontes', pet: 'Pipoca, poodle toy.', clube: true },
  { nome: 'Diego Lacerda', pet: 'Bolt, border collie.' },
  { nome: 'Eliane Prates', pet: 'Luna e Nina, gatas persas.' },
  { nome: 'Fábio Cordeiro', pet: 'Rex, pastor alemão.' },
  { nome: 'Gabriela Siqueira', pet: 'Amora, yorkshire.', clube: true },
  { nome: 'Henrique Aragão', pet: 'Bento, labrador.' },
  { nome: 'Isabela Quintana', pet: 'Fiona, spitz alemão.' },
  { nome: 'João Pedro Salles', pet: 'Tobias, beagle.' },
  { nome: 'Karina Bastos', pet: 'Nina, maltês.', clube: true },
  { nome: 'Leandro Veloso', pet: 'Zeca, bulldog francês.' },
  { nome: 'Mariana Teixeira', pet: 'Princesa, lhasa apso. Alérgica a perfume forte.' },
  { nome: 'Nelson Prado', pet: 'Duque, rottweiler. Dócil, mas desconfia de estranhos.' },
  { nome: 'Olívia Ramos', pet: 'Chico, vira-lata caramelo.' },
  { nome: 'Paulo Henrique Dias', pet: 'Max, pinscher.' },
  { nome: 'Queila Moura', pet: 'Branca, gata angorá.' },
  { nome: 'Rodrigo Esteves', pet: 'Simba, chow chow. Tosa só na tesoura.', clube: true },
  { nome: 'Sabrina Couto', pet: 'Lola, cavalier king charles.' },
  { nome: 'Thiago Ferraz', pet: 'Apolo, husky siberiano.' },
  { nome: 'Úrsula Mendes', pet: 'Dora, dachshund.' },
  { nome: 'Vinícius Batista', pet: 'Pingo, jack russell.' },
  { nome: 'Wanda Carvalho', pet: 'Mingau, gato siamês.' },
  { nome: 'Xavier Pinheiro', pet: 'Trovão, boxer.' },
  { nome: 'Yara Bittencourt', pet: 'Cacau, cocker spaniel.', clube: true },
  { nome: 'Zélia Andrade', pet: 'Biscoito, pug.' },
  { nome: 'Alexandre Bonfim', pet: 'Rocky, staffordshire.' },
  { nome: 'Beatriz Camargo', pet: 'Estrela, samoieda.' },
  { nome: 'Caetano Rezende', pet: 'Fred, schnauzer.' },
  { nome: 'Daniela Freitas', pet: 'Gigi, poodle médio.' },
  { nome: 'Eduardo Sampaio', pet: 'Jade, pastor belga.' },
  { nome: 'Fernanda Guedes', pet: 'Moli, lulu da pomerânia.', clube: true },
  { nome: 'Gustavo Neves', pet: 'Totó, vira-lata.' },
  { nome: 'Helena Barros', pet: 'Pérola, gata ragdoll.' },
  { nome: 'Ícaro Valadares', pet: 'Nick, golden retriever.' },
  { nome: 'Juliana Cardoso', pet: 'Bela, bichon frisé.' },
  { nome: 'Kleber Monteiro', pet: 'Hulk, american bully.' },
  { nome: 'Larissa Vieira', pet: 'Charlotte, yorkshire.' },
  { nome: 'Mateus Coelho', pet: 'Oliver, basset hound.' },
  { nome: 'Natália Peixoto', pet: 'Cléo e Tom, gatos sem raça definida.' },
]

export const DEMO_PREMIOS = [
  { nome: 'Petisco natural', descricao: 'Um saquinho de petisco natural para o seu pet.', pontos: 40, estoque: 50 },
  { nome: 'Corte de unhas grátis', descricao: 'Corte de unhas na próxima visita.', pontos: 60, estoque: null },
  { nome: 'Hidratação grátis', descricao: 'Hidratação de pelagem na próxima visita.', pontos: 120, estoque: null },
  { nome: 'Banho grátis (porte pequeno)', descricao: 'Um banho para cães de porte pequeno.', pontos: 150, estoque: null },
  { nome: 'Kit de brinquedos', descricao: 'Bolinha, corda e mordedor.', pontos: 300, estoque: 5 },
  { nome: 'Caminha pet', descricao: 'Caminha macia tamanho M.', pontos: 500, estoque: 3 },
] as const

/** `inicio` e `fim` em dias a partir de hoje (`null` = sem limite). */
export const DEMO_BANNERS = [
  { titulo: 'Semana do banho e tosa', link: null, inicio: null, fim: 20, cor: '#2F7D5B' },
  { titulo: 'Ração premium com desconto', link: null, inicio: -5, fim: 10, cor: '#F29A4B' },
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

export const DEMO_PARCEIROS = [
  {
    nome: 'Clínica Veterinária Vida Animal',
    descricao: 'Clínica parceira, a duas quadras do pet shop.',
    endereco: 'Rua das Palmeiras, 340, Jardim Paulista, São Paulo',
    telefone: '(11) 3000-4500',
    site: 'https://vidaanimal.exemplo.com.br',
    cor: '#3D9970',
    vouchers: [
      { nome: 'Consulta veterinária', descricao: 'Uma consulta clínica geral.', regras: 'Agendar com antecedência pelo telefone da clínica.', centavos: 9000, estoque: 20, validadeDias: 60 },
      { nome: 'Vacina polivalente', descricao: 'Uma dose de vacina V10 ou V4.', regras: 'Válido para animais com mais de 45 dias.', centavos: 7500, estoque: 15, validadeDias: 90 },
    ],
  },
  {
    nome: 'Hotel Pet Cantinho Feliz',
    descricao: 'Hospedagem e creche para cães e gatos.',
    endereco: 'Av. dos Ipês, 800, Vila Mariana, São Paulo',
    telefone: '(11) 3000-7788',
    site: 'https://cantinhofeliz.exemplo.com.br',
    cor: '#E0A03D',
    vouchers: [{ nome: 'Diária de hotelzinho', descricao: 'Uma diária com alimentação.', regras: 'Reserva sujeita à disponibilidade; levar carteira de vacinação.', centavos: 7000, estoque: 12, validadeDias: 120 }],
  },
] as const

/** Dia (em relação a hoje, negativo = passado), hora do dia em minutos, cliente, itens e desfecho. */
export type DemoPedido = {
  diasAtras: number
  minuto: number
  cliente: number
  /** `produto` e `voucher` são índices em `DEMO_PRODUTOS` e na lista plana de vouchers. */
  linhas: ({ produto: number; qtd: number } | { voucher: number; qtd: number })[]
  fim: 'entregue' | 'pronto' | 'pago' | 'cancelado_pago' | 'cancelado' | 'voucher' | 'voucher_usado'
}

export const DEMO_PEDIDOS: DemoPedido[] = [
  { diasAtras: 27, minuto: 620, cliente: 0, linhas: [{ produto: 0, qtd: 1 }, { produto: 3, qtd: 2 }], fim: 'entregue' },
  { diasAtras: 25, minuto: 700, cliente: 4, linhas: [{ produto: 1, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 24, minuto: 905, cliente: 7, linhas: [{ produto: 6, qtd: 2 }, { produto: 7, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 22, minuto: 650, cliente: 12, linhas: [{ voucher: 0, qtd: 1 }], fim: 'voucher_usado' },
  { diasAtras: 20, minuto: 780, cliente: 2, linhas: [{ produto: 10, qtd: 1 }, { produto: 11, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 19, minuto: 990, cliente: 17, linhas: [{ produto: 14, qtd: 1 }, { produto: 15, qtd: 1 }], fim: 'cancelado_pago' },
  { diasAtras: 17, minuto: 600, cliente: 9, linhas: [{ produto: 2, qtd: 2 }], fim: 'entregue' },
  { diasAtras: 15, minuto: 840, cliente: 20, linhas: [{ produto: 12, qtd: 1 }], fim: 'cancelado' },
  { diasAtras: 14, minuto: 700, cliente: 1, linhas: [{ voucher: 2, qtd: 1 }], fim: 'voucher_usado' },
  { diasAtras: 12, minuto: 930, cliente: 24, linhas: [{ produto: 17, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 10, minuto: 660, cliente: 3, linhas: [{ produto: 0, qtd: 1 }, { produto: 5, qtd: 3 }], fim: 'entregue' },
  { diasAtras: 9, minuto: 735, cliente: 30, linhas: [{ voucher: 1, qtd: 2 }], fim: 'voucher' },
  { diasAtras: 7, minuto: 870, cliente: 6, linhas: [{ produto: 8, qtd: 1 }], fim: 'entregue' },
  { diasAtras: 6, minuto: 615, cliente: 15, linhas: [{ produto: 3, qtd: 1 }, { produto: 4, qtd: 2 }], fim: 'entregue' },
  { diasAtras: 4, minuto: 960, cliente: 33, linhas: [{ produto: 16, qtd: 2 }, { produto: 18, qtd: 1 }], fim: 'pronto' },
  { diasAtras: 3, minuto: 690, cliente: 8, linhas: [{ produto: 1, qtd: 1 }, { produto: 10, qtd: 1 }], fim: 'pronto' },
  { diasAtras: 2, minuto: 800, cliente: 22, linhas: [{ produto: 13, qtd: 1 }], fim: 'pago' },
  { diasAtras: 1, minuto: 645, cliente: 26, linhas: [{ produto: 0, qtd: 1 }], fim: 'pago' },
  { diasAtras: 1, minuto: 900, cliente: 35, linhas: [{ voucher: 0, qtd: 1 }], fim: 'voucher' },
  { diasAtras: 1, minuto: 1010, cliente: 10, linhas: [{ produto: 6, qtd: 3 }], fim: 'cancelado' },
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
  /** Sorteio de 0 a 1 que decide o desfecho de uma marcação já passada. */
  sorteio: number
}

export type EntradaDoPlano = {
  /** Data local (AAAA-MM-DD) de referência: a agenda vai de `ancora - 28` a `ancora + 14`. */
  ancora: string
  fuso: string
  /** Datas sem expediente (fechamentos). */
  fechados: readonly string[]
  /** Horários já bloqueados (por profissional e data). */
  bloqueios: readonly { profissional: number; data: string; startMin: number; endMin: number }[]
  clubeDosClientes: readonly boolean[]
}

type Intervalo = { startMin: number; endMin: number }
const sobrepoe = (a: Intervalo, b: Intervalo) => a.startMin < b.endMin && b.startMin < a.endMin

/**
 * Distribui as marcações dos 28 dias passados e dos 14 seguintes, em rodízio de profissionais e de clientes (alguns
 * clientes voltam bem mais que outros), sem sobrepor horários de um profissional, de um cliente nem bloqueios.
 */
export function planejarAgenda(e: EntradaDoPlano): Marcacao[] {
  const sorteio = sorteador(20261123)
  const clientes = e.clubeDosClientes.length
  const ocupadoProf = new Map<string, Intervalo[]>()
  const ocupadoCliente = new Map<string, Intervalo[]>()
  for (const b of e.bloqueios) {
    const chave = `${b.profissional}|${b.data}`
    ocupadoProf.set(chave, [...(ocupadoProf.get(chave) ?? []), { startMin: b.startMin, endMin: b.endMin }])
  }
  const marcacoes: Marcacao[] = []
  for (let delta = -DIAS_PASSADO; delta <= DIAS_FUTURO; delta += 1) {
    const data = addDays(e.ancora, delta)
    if (e.fechados.includes(data)) continue
    const dia = weekdayOf(data)
    if (!WEEKDAYS.includes(dia)) continue
    // Mais movimento no passado e mais folga nas últimas semanas do futuro.
    const chance = delta < 0 ? 0.52 : Math.max(0.2, 0.5 - delta * 0.02)
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
          let cliente = Math.floor(sorteio() ** 1.5 * clientes)
          let combinacao = prof.combinacoes[Math.floor(sorteio() * prof.combinacoes.length)] ?? [1]
          if (combinacao.includes(9) && e.clubeDosClientes[cliente] !== true) {
            const clube = e.clubeDosClientes.findIndex((c, n) => c && n >= cliente)
            if (clube >= 0) cliente = clube
            else combinacao = [prof.servicos[0] ?? 0]
          }
          const minutos = combinacao.reduce((soma, n) => soma + (DEMO_SERVICOS[n]?.minutos ?? 0), 0)
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
