// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { LojaPublica, type LojaPublicaVisit } from '@/app/app/[slug]/_lib/LojaPublica'
import type { Storefront } from '@/server/domain/storefront/storefront'

vi.mock('@/app/app/[slug]/actions', () => ({ usarMinhaConta: vi.fn() }))

const loja: Storefront = {
  name: 'Focinho Feliz',
  address: 'Rua das Flores, 10, São Paulo - SP',
  phone: { label: '(11) 91234-5678', href: 'tel:+5511912345678', whatsappHref: 'https://wa.me/5511912345678' },
  services: [
    { id: '1', name: 'Banho', description: 'Banho completo com secagem', icon: 'bath', from: { cents: 5000, varies: true }, durationLabel: '1 h a 1 h 30', clubOnly: false },
    { id: '2', name: 'Spa', description: null, icon: 'sparkles', from: { cents: 12000, varies: false }, durationLabel: '2 h', clubOnly: true },
  ],
  modules: { loyalty: false, store: false, banners: false } as Storefront['modules'],
  petNiche: true,
  servesCats: true,
  rules: { changeWindowMin: 120, changeWindowLabel: 'até 2 h antes' },
}
const marca: { name: string; logoUrl: string | null; symbolUrl: string | null; loginImageUrl: string | null } = { name: 'Focinho Feliz', logoUrl: null, symbolUrl: null, loginImageUrl: null }
const pessoa = { userId: 'u1', name: 'Marina Souza', email: 'marina@exemplo.test', phone: '(11) 98888-7777' }

function ver(visit: LojaPublicaVisit, o: { volta?: string | null; brand?: typeof marca } = {}) {
  return render(<LojaPublica slug="loja-a" brand={o.brand ?? marca} storefront={loja} visit={visit} volta={o.volta ?? null} />)
}

describe('LojaPublica', () => {
  test('anônimo vê serviços com "a partir de R$ 50,00" e o botão Agendar com volta', () => {
    ver({ kind: 'anonymous' })
    expect(screen.getByRole('heading', { level: 1, name: 'Focinho Feliz' })).toBeInTheDocument()
    expect(screen.getByText(/a partir de R\$\s50,00/)).toBeInTheDocument()
    expect(screen.getByText(/R\$\s120,00/)).toBeInTheDocument()
    expect(screen.getByText('1 h a 1 h 30')).toBeInTheDocument()
    expect(screen.getByText('Clube')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Agendar' })).toHaveAttribute('href', '/loja-a/entrar?volta=%2Floja-a%2Fagendar')
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/loja-a/entrar')
    expect(screen.getByText(/Prazo para mudar um horário: até 2 h antes\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '(11) 91234-5678' })).toHaveAttribute('href', 'tel:+5511912345678')
    expect(screen.getByRole('link', { name: /WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/5511912345678')
    expect(screen.getByRole('link', { name: 'Feito com Agenda Flui' })).toBeInTheDocument()
  })

  test('visitante vê "Usar minha conta nesta loja" com nome, e-mail e telefone', () => {
    ver({ kind: 'visitor', person: pessoa, isStaff: false, blocked: false })
    const cartao = screen.getByRole('form', { name: 'Usar minha conta nesta loja' })
    expect(within(cartao).getByText('A loja vai ver seu nome, e-mail e telefone.')).toBeInTheDocument()
    expect(within(cartao).getByText('Marina Souza')).toBeInTheDocument()
    expect(within(cartao).getByText('marina@exemplo.test')).toBeInTheDocument()
    expect(within(cartao).getByText('(11) 98888-7777')).toBeInTheDocument()
    expect(within(cartao).getByRole('button', { name: 'Usar minha conta e agendar' })).toBeInTheDocument()
    expect((cartao.querySelector('input[name="volta"]') as HTMLInputElement).value).toBe('/loja-a/agendar')
    expect(screen.queryByRole('link', { name: 'Agendar' })).toBeNull()
  })

  test('visitante que veio de outra tela segue para o volta depois de usar a conta', () => {
    ver({ kind: 'visitor', person: pessoa, isStaff: false, blocked: false }, { volta: '/loja-a/horarios' })
    expect((document.querySelector('input[name="volta"]') as HTMLInputElement).value).toBe('/loja-a/horarios')
  })

  test('blocked vê o aviso de conta desativada e nenhum botão de agendar', () => {
    ver({ kind: 'visitor', person: pessoa, isStaff: false, blocked: true })
    expect(screen.getByRole('alert')).toHaveTextContent('Sua conta nesta loja está desativada. Fale com a loja.')
    expect(screen.queryByRole('button', { name: /Usar minha conta/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Agendar' })).toBeNull()
  })

  test('equipe vê "Abrir painel"', () => {
    ver({ kind: 'visitor', person: pessoa, isStaff: true, blocked: false })
    expect(screen.getByRole('link', { name: 'Abrir painel' })).toHaveAttribute('href', '/painel')
    expect(screen.getByRole('link', { name: 'Minha conta' })).toHaveAttribute('href', '/conta')
  })

  test('sem capa: painel com bolhas aria-hidden', () => {
    const { container } = ver({ kind: 'anonymous' })
    expect(container.querySelector('.af-cl-cover img')).toBeNull()
    expect(container.querySelector('.af-cl-cover .af-bubbles')).toHaveAttribute('aria-hidden', 'true')
  })

  test('com capa: a imagem cobre o bloco e é decorativa', () => {
    const { container } = ver({ kind: 'anonymous' }, { brand: { ...marca, loginImageUrl: '/arquivos/capa.png' } })
    const img = container.querySelector('.af-cl-cover img')
    expect(img).toHaveAttribute('src', '/arquivos/capa.png')
    expect(img).toHaveAttribute('alt', '')
  })

  test('loja sem serviços publicados convida a falar com ela', () => {
    render(<LojaPublica slug="loja-a" brand={marca} storefront={{ ...loja, services: [] }} visit={{ kind: 'anonymous' }} volta={null} />)
    expect(screen.getByText(/ainda não publicou os serviços/)).toBeInTheDocument()
  })
})
