/** Dados fixos das contas de demonstração. Sem importações: os testes e2e também leem este arquivo. */

export type DemoPapel = 'dono' | 'gerente' | 'profissional'

const DOMINIO = 'agendaflui.localhost'

/** E-mail de demonstração de cada papel numa conta ("patas" ou "navalha"). */
export function demoEmail(conta: 'patas' | 'navalha', papel: DemoPapel): string {
  return `${papel}.${conta}@${DOMINIO}`
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
  },
] as const

export const DEMO_MULTI_NOME = 'Helena Prado'
