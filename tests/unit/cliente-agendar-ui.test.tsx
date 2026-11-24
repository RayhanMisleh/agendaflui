// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgendarFluxo } from '@/app/app/[slug]/agendar/AgendarFluxo'
import type { Consultas, PetDoFluxo } from '@/app/app/[slug]/agendar/tipos'

const acoes = vi.hoisted(() => ({ marcar: vi.fn(), remarcar: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/app/app/[slug]/agendar/actions', () => ({ marcarHorario: acoes.marcar, remarcarHorario: acoes.remarcar }))
vi.mock('@/app/app/[slug]/agendar/consultas', () => ({ servicosDoPet: vi.fn(), profissionaisPara: vi.fn(), diasLivres: vi.fn(), horariosLivres: vi.fn() }))

const thor: PetDoFluxo = { id: 'thor', name: 'Thor', typeLabel: 'Cão médio', rangeLabel: '10 a 25 kg', variant: 'DOG_MEDIUM', photoUrl: null, bookable: true }
const mel: PetDoFluxo = { id: 'mel', name: 'Mel', typeLabel: 'Gato', rangeLabel: null, variant: 'CAT', photoUrl: null, bookable: false }

const banho = { id: 'banho', name: 'Banho', description: 'Banho com secagem', icon: 'bath' as const, priceCents: 8500, durationMin: 60, durationLabel: '1 h', clubOnly: false, locked: false }
const tosa = { id: 'tosa', name: 'Tosa', description: null, icon: 'scissors' as const, priceCents: 5000, durationMin: 90, durationLabel: '1 h 30', clubOnly: false, locked: false }

function consultas(o: Partial<Consultas> = {}): Consultas {
  return {
    servicos: vi.fn(async () => ({ ok: true as const, servicos: [banho, tosa] })),
    profissionais: vi.fn(async () => ({
      ok: true as const,
      profissionais: [
        { id: 'ana', name: 'Ana', avatarUrl: null },
        { id: 'bia', name: 'Bia', avatarUrl: null },
      ],
    })),
    dias: vi.fn(async () => ({
      ok: true as const,
      dias: [
        { date: '2026-11-28', label: '28', weekdayShort: 'Sáb', available: true },
        { date: '2026-11-29', label: '29', weekdayShort: 'Dom', available: false },
      ],
      hasMore: false,
      proximo: '2026-11-30',
    })),
    horarios: vi.fn(async () => ({ ok: true as const, horarios: [{ iso: '2026-11-28T17:30:00.000Z', label: '14:30' }, { iso: '2026-11-28T12:00:00.000Z', label: '09:00' }] })),
    ...o,
  }
}

function ver(c: Consultas, pets: PetDoFluxo[] = [thor]) {
  render(<AgendarFluxo slug="loja-a" today="2026-11-25" pets={pets} modo="novo" consultas={c} />)
  return userEvent.setup()
}

beforeEach(() => {
  acoes.marcar.mockReset()
})

test('serviços mostram o preço do porte do pet e o total corre na barra', async () => {
  const user = ver(consultas())
  expect(screen.getByRole('heading', { name: 'Quais serviços?' })).toBeInTheDocument()
  expect(await screen.findByText('1 h · R$ 85,00')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull()
  await user.click(screen.getByRole('checkbox', { name: /Banho/ }))
  await user.click(screen.getByRole('checkbox', { name: /Tosa/ }))
  expect(screen.getByText('Total R$ 135,00 · 2 h 30')).toBeInTheDocument()
})

test('gato com gatos desligados aparece desabilitado com o motivo', () => {
  ver(consultas(), [thor, { ...thor, id: 'rex', name: 'Rex' }, mel])
  expect(screen.getByRole('heading', { name: 'Para qual pet?' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Mel/ })).toBeDisabled()
  expect(screen.getByText('A loja não atende gatos no momento')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Adicionar pet' })).toHaveAttribute('href', '/loja-a/boas-vindas?novo=1&volta=%2Floja-a%2Fagendar')
})

test('serviço vazio diz o que fazer', async () => {
  ver(consultas({ servicos: vi.fn(async () => ({ ok: true as const, servicos: [] })) }))
  expect(await screen.findByText('Nenhum serviço para Cão médio agora. Fale com a loja.')).toBeInTheDocument()
})

test('falha de consulta mostra a mensagem e Tentar de novo', async () => {
  const servicos = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, message: 'Não foi possível concluir agora.', reentrar: null })
    .mockResolvedValue({ ok: true, servicos: [banho] })
  const user = ver(consultas({ servicos }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível concluir agora.')
  await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
  expect(await screen.findByRole('checkbox', { name: /Banho/ })).toBeInTheDocument()
  expect(servicos).toHaveBeenCalledTimes(2)
})

async function ateOHorario(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('checkbox', { name: /Banho/ })
  await user.click(screen.getByRole('checkbox', { name: /Banho/ }))
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  await user.click(await screen.findByRole('radio', { name: /Ana/ }))
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
}

test('escolher horário mostra a barra Continuar com o resumo; "Qualquer um" vem primeiro', async () => {
  const user = ver(consultas())
  await screen.findByRole('checkbox', { name: /Banho/ })
  await user.click(screen.getByRole('checkbox', { name: /Banho/ }))
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  const radios = await screen.findAllByRole('radio')
  expect(radios[0]).toHaveAccessibleName(/Qualquer um/)
  await user.click(screen.getByRole('radio', { name: /Ana/ }))
  expect(screen.getByText('Ana', { selector: '.af-cl-bar__summary' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(await screen.findByRole('heading', { name: 'Quando?' })).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: '14:30' }))
  expect(screen.getByText('sábado, 28 de novembro, 14:30')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument()
})

test('dia sem horário avisa', async () => {
  const user = ver(consultas({ horarios: vi.fn(async () => ({ ok: true as const, horarios: [] })) }))
  await ateOHorario(user)
  expect(await screen.findByText('Sem horários neste dia. Escolha outro.')).toBeInTheDocument()
})

test('só um profissional faz os serviços: o passo some e vai direto ao horário', async () => {
  const user = ver(consultas({ profissionais: vi.fn(async () => ({ ok: true as const, profissionais: [{ id: 'ana', name: 'Ana', avatarUrl: null }] })) }))
  await screen.findByRole('checkbox', { name: /Banho/ })
  await user.click(screen.getByRole('checkbox', { name: /Banho/ }))
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(await screen.findByRole('heading', { name: 'Quando?' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Com quem?' })).toBeNull()
})

test('confirmar mostra o resumo; horário tomado volta ao horário com aviso e sugestões', async () => {
  acoes.marcar.mockResolvedValue({
    ok: false,
    message: 'Esse horário acabou de ser ocupado. Escolha outro.',
    fields: {},
    values: {},
    conflict: { nearest: [{ iso: '2026-11-28T18:00:00.000Z', label: '15:00', date: '2026-11-28' }] },
  })
  const user = ver(consultas())
  await ateOHorario(user)
  await user.click(await screen.findByRole('button', { name: '14:30' }))
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  expect(screen.getByRole('heading', { name: 'Tudo certo?' })).toBeInTheDocument()
  const resumo = screen.getByRole('heading', { name: 'Tudo certo?' }).closest('section') as HTMLElement
  expect(within(resumo).getByText('R$ 85,00', { selector: 'span' })).toBeInTheDocument()
  await user.type(screen.getByLabelText('Recado para a loja'), 'Cuidado com o secador')
  await user.click(screen.getByRole('button', { name: 'Confirmar horário' }))
  await waitFor(() => expect(acoes.marcar).toHaveBeenCalledTimes(1))
  const fd = acoes.marcar.mock.calls[0]?.[2] as FormData
  expect(fd.get('petId')).toBe('thor')
  expect(fd.getAll('serviceIds')).toEqual(['banho'])
  expect(fd.get('professionalId')).toBe('ana')
  expect(fd.get('startsAt')).toBe('2026-11-28T17:30:00.000Z')
  expect(fd.get('customerNote')).toBe('Cuidado com o secador')
  expect(String(fd.get('key'))).toMatch(/^[A-Za-z0-9_-]{8,80}$/)
  expect(await screen.findByRole('heading', { name: 'Quando?' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Esse horário acabou de ser ocupado. Escolha outro.')
  await user.click(screen.getByRole('button', { name: '15:00' }))
  expect(screen.getByRole('button', { name: 'Continuar' })).toBeInTheDocument()
  // a mesma chave segue no segundo envio
  await user.click(screen.getByRole('button', { name: 'Continuar' }))
  await user.click(screen.getByRole('button', { name: 'Confirmar horário' }))
  await waitFor(() => expect(acoes.marcar).toHaveBeenCalledTimes(2))
  expect((acoes.marcar.mock.calls[1]?.[2] as FormData).get('key')).toBe(fd.get('key'))
  expect((acoes.marcar.mock.calls[1]?.[2] as FormData).get('startsAt')).toBe('2026-11-28T18:00:00.000Z')
})
