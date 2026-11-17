import { CAPABILITIES, can } from '@/server/auth/capabilities'
import type { Actor } from '@/server/auth/actor'
import type { Terms } from '@/server/domain/settings/terms'
import type { Modules } from '@/server/domain/settings/painel-context'
import { painelNav } from '@/ui/shells/painel-nav'

const TERMOS: Terms = {
  professionalSingular: 'Tosador',
  professionalPlural: 'Tosadores',
  customerSingular: 'Tutor',
  customerPlural: 'Tutores',
  pointsSingular: 'Ponto',
  pointsPlural: 'Pontos',
  club: 'Clube',
}
const MODULOS: Modules = { loyalty: false, banners: false, store: false, vouchers: false }
const TODOS_LIGADOS: Modules = { loyalty: true, banners: true, store: true, vouchers: true }

function navDe(role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', modules = MODULOS) {
  const actor: Actor = { kind: 'member', userId: 'u', membershipId: 'm', name: 'Ana', role }
  return painelNav({ can: (c) => can(actor, c), modules, terms: TERMOS })
}
const rotulos = (role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', modules?: Modules) => navDe(role, modules).map((i) => i.label)

test('o dono vê as sete divisões, na ordem, com os termos da conta', () => {
  expect(navDe('OWNER').map((i) => [i.label, i.href])).toEqual([
    ['Início', '/'],
    ['Agenda', '/agenda'],
    ['Tutores', '/clientes'],
    ['Tosadores', '/equipe'],
    ['Serviços', '/servicos'],
    ['Relatórios', '/relatorios'],
    ['Configurações', '/configuracoes'],
  ])
})

test('o gerente vê as mesmas divisões do dono (os dados da conta ficam dentro de Configurações)', () => {
  expect(rotulos('MANAGER')).toEqual(rotulos('OWNER'))
})

test('o profissional não vê Equipe, Serviços, relatórios gerais nem as configurações do negócio', () => {
  const r = rotulos('PROFESSIONAL')
  expect(r).toEqual(['Início', 'Agenda', 'Tutores', 'Meus números', 'Meu perfil'])
  expect(r).not.toContain('Tosadores')
  expect(r).not.toContain('Relatórios')
  expect(r).not.toContain('Configurações')
})

test('cada divisão só aparece para quem tem a capacidade dela', () => {
  const sem = (faltando: string) => painelNav({ can: (c) => c !== faltando, modules: MODULOS, terms: TERMOS }).map((i) => i.href)
  expect(sem('view_own_agenda')).not.toContain('/agenda')
  expect(sem('view_clients')).not.toContain('/clientes')
  expect(sem('manage_team')).not.toContain('/equipe')
  expect(sem('manage_catalog')).not.toContain('/servicos')
  expect(painelNav({ can: () => false, modules: MODULOS, terms: TERMOS })).toEqual([])
})

test('o rótulo acompanha o termo da conta, não um texto fixo', () => {
  const nav = painelNav({ can: () => true, modules: MODULOS, terms: { ...TERMOS, customerPlural: 'Hóspedes', professionalPlural: 'Guias' } })
  expect(nav.map((i) => i.label)).toEqual(expect.arrayContaining(['Hóspedes', 'Guias']))
  expect(nav.map((i) => i.label)).not.toContain('Clientes')
})

test('os módulos da Fase 5 não criam divisões, ligados ou desligados', () => {
  expect(rotulos('OWNER', TODOS_LIGADOS)).toEqual(rotulos('OWNER', MODULOS))
})

test('todo item traz ícone e as sete capacidades da navegação existem', () => {
  for (const item of navDe('OWNER')) expect(item.icon).toBeTruthy()
  for (const c of ['view_dashboard', 'view_own_agenda', 'view_clients', 'manage_team', 'manage_catalog', 'view_own_reports', 'manage_settings'])
    expect(CAPABILITIES).toContain(c)
})

test('os rótulos curtos, quando existem, cabem na barra do celular', () => {
  const curtos = [...navDe('OWNER'), ...navDe('PROFESSIONAL')].filter((i) => i.shortLabel)
  expect(curtos.length).toBeGreaterThan(0)
  for (const item of curtos) expect(item.shortLabel!.length).toBeLessThanOrEqual(8)
})
