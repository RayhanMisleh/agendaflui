import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { moveService, reorderServices } from '@/server/domain/catalog/services'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeService } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  arquivarServico,
  criarServico,
  editarServico,
  moverServico,
  restaurarServico,
} from '@/app/app/painel/servicos/actions'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}
const CAMPOS = { name: 'Banho', description: '', icon: 'sparkles', price: '35,90', durationMin: '30', rewardPoints: '0' }

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness()).id
  dono = await ctxWithRole({ id: businessId }, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
})
afterEach(() => guards.requireTenant.mockReset())

const servicos = () => prisma.service.findMany({ where: { businessId }, orderBy: { displayOrder: 'asc' } })

describe('criar e editar', () => {
  test('preço "35,90" grava 3590 centavos e o serviço entra ativo', async () => {
    const r = await criarServico(ini, form({ ...CAMPOS, active: 'on' }))
    expect(r.ok).toBe(true)
    const [s] = await servicos()
    expect(s?.priceCents).toBe(3590)
    expect(s?.active).toBe(true)
    expect(s?.durationMin).toBe(30)
  })

  test('preço com ponto vale o mesmo, e texto volta como erro no campo do preço', async () => {
    await criarServico(ini, form({ ...CAMPOS, price: '35.90' }))
    expect((await servicos())[0]?.priceCents).toBe(3590)
    const r = await criarServico(ini, form({ ...CAMPOS, name: 'Outro', price: 'abc' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toEqual(['price'])
    expect(r.values.price).toBe('abc')
    expect(await prisma.service.count({ where: { businessId } })).toBe(1)
  })

  test('duração fora da grade da conta volta como erro no campo da duração', async () => {
    // A grade padrão é de 15 minutos: 20 é múltiplo de 5, mas não da grade.
    const r = await criarServico(ini, form({ ...CAMPOS, durationMin: '20' }))
    expect(r.ok).toBe(false)
    expect(r.fields.durationMin).toContain('15 minutos')
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)
  })

  test('ícone fora da lista do design system volta como erro no campo do ícone', async () => {
    const r = await criarServico(ini, form({ ...CAMPOS, icon: 'bomba' }))
    expect(r.ok).toBe(false)
    expect(r.fields.icon).toBeTruthy()
  })

  test('edita nome, preço e só-para-clube; desligar a caixa de ativo desativa', async () => {
    const s = await makeService(businessId, { name: 'Velho' })
    const r = await editarServico(ini, form({ ...CAMPOS, id: s.id, name: 'Novo', price: '10', loyalty: '1', clubOnly: 'on', rewardPoints: '5' }))
    expect(r.ok).toBe(true)
    const depois = await prisma.service.findUniqueOrThrow({ where: { id: s.id } })
    expect(depois).toMatchObject({ name: 'Novo', priceCents: 1000, clubOnly: true, rewardPoints: 5, active: false })
  })

  test('sem o módulo de fidelidade no formulário, pontos e clube ficam como estão', async () => {
    const s = await makeService(businessId, { clubOnly: true, rewardPoints: 7 })
    await editarServico(ini, form({ ...CAMPOS, id: s.id, active: 'on' }))
    expect(await prisma.service.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ clubOnly: true, rewardPoints: 7 })
  })

  test('serviço de outra conta não é encontrado', async () => {
    const outra = await makeBusiness()
    const alheio = await makeService(outra.id, { name: 'Alheio' })
    const r = await editarServico(ini, form({ ...CAMPOS, id: alheio.id, name: 'Invadido' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe('Serviço não encontrado.')
    expect((await prisma.service.findUniqueOrThrow({ where: { id: alheio.id } })).name).toBe('Alheio')
  })
})

describe('permissões', () => {
  test('profissional criando serviço recebe "sem permissão" e nada é gravado', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    const r = await criarServico(ini, form(CAMPOS))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(NEGADO)
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)
  })

  test('profissional não edita, não move, não arquiva nem restaura', async () => {
    const s = await makeService(businessId, { name: 'Intacto' })
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    for (const r of [
      await editarServico(ini, form({ ...CAMPOS, id: s.id })),
      await moverServico(ini, form({ id: s.id, direction: 'down' })),
      await arquivarServico(ini, form({ id: s.id })),
      await restaurarServico(ini, form({ id: s.id })),
    ]) {
      expect(r.message).toBe(NEGADO)
    }
    expect(await prisma.service.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ name: 'Intacto', archivedAt: null })
  })

  test('gerente e suporte (entrando como) podem criar', async () => {
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    expect((await criarServico(ini, form(CAMPOS))).ok).toBe(true)
  })
})

describe('ordem', () => {
  async function tres() {
    const a = await makeService(businessId, { name: 'A', displayOrder: 1 })
    const b = await makeService(businessId, { name: 'B', displayOrder: 2 })
    const c = await makeService(businessId, { name: 'C', displayOrder: 3 })
    return { a, b, c }
  }
  const nomes = async () => (await servicos()).map((s) => s.name).join('')

  test('descer e subir trocam com o vizinho; nas pontas nada muda', async () => {
    const { a, c } = await tres()
    await moverServico(ini, form({ id: a.id, direction: 'down' }))
    expect(await nomes()).toBe('BAC')
    await moverServico(ini, form({ id: a.id, direction: 'up' }))
    expect(await nomes()).toBe('ABC')
    await moverServico(ini, form({ id: a.id, direction: 'up' }))
    await moverServico(ini, form({ id: c.id, direction: 'down' }))
    expect(await nomes()).toBe('ABC')
  })

  test('serviço arquivado fica fora da ordem', async () => {
    const { a, b } = await tres()
    await arquivarServico(ini, form({ id: b.id }))
    await moverServico(ini, form({ id: a.id, direction: 'down' }))
    const ativos = (await servicos()).filter((s) => s.archivedAt === null)
    expect(ativos.map((s) => s.name).join('')).toBe('CA')
    expect(new Set(ativos.map((s) => s.displayOrder)).size).toBe(2)
  })

  test('duas pessoas ordenando ao mesmo tempo terminam com a ordem sem repetição', async () => {
    const lista = await Promise.all(Array.from({ length: 6 }, (_, i) => makeService(businessId, { name: `S${i}`, displayOrder: i + 1 })))
    const ids = lista.map((s) => s.id)
    const outra = await ctxWithRole({ id: businessId }, 'MANAGER')
    const invertida = [...ids].reverse()
    const resultados = await Promise.allSettled([
      ...ids.map((id, i) => moverServico(ini, form({ id, direction: i % 2 === 0 ? 'down' : 'up' }))),
      reorderServices(dono, ids),
      reorderServices(outra, invertida),
      reorderServices(dono, invertida),
      reorderServices(outra, ids),
    ])
    for (const r of resultados) expect(r.status).toBe('fulfilled')
    const ordens = (await servicos()).map((s) => s.displayOrder).sort((x, y) => x - y)
    expect(ordens).toEqual([1, 2, 3, 4, 5, 6])
  })

  test('vários "descer" no mesmo serviço ao mesmo tempo se somam: o primeiro vai ao fim, sem perder movimento', async () => {
    const lista = await Promise.all(['A', 'B', 'C', 'D', 'E', 'F'].map((nome, i) => makeService(businessId, { name: nome, displayOrder: i + 1 })))
    const [a] = lista
    await Promise.all(Array.from({ length: 5 }, () => moveService(dono, a?.id ?? '', 'down')))
    expect(await nomes()).toBe('BCDEFA')
  })

  test('lista desatualizada na reordenação é recusada sem mexer em nada', async () => {
    const { a, b } = await tres()
    const e = await domainError(reorderServices(dono, [a.id, b.id]))
    expect(e.code).toBe('validation')
    expect(await nomes()).toBe('ABC')
  })
})

describe('arquivar e restaurar', () => {
  test('arquiva e restaura o serviço, que volta ao fim da lista', async () => {
    const s = await makeService(businessId, { name: 'Um', displayOrder: 1 })
    await makeService(businessId, { name: 'Dois', displayOrder: 2 })
    expect((await arquivarServico(ini, form({ id: s.id }))).ok).toBe(true)
    expect((await prisma.service.findUniqueOrThrow({ where: { id: s.id } })).archivedAt).not.toBeNull()
    expect((await restaurarServico(ini, form({ id: s.id }))).ok).toBe(true)
    const volta = await prisma.service.findUniqueOrThrow({ where: { id: s.id } })
    expect(volta.archivedAt).toBeNull()
    expect(volta.displayOrder).toBe(3)
  })
})

test('sem sessão a ação redireciona e não grava', async () => {
  guards.requireTenant.mockRejectedValue(new Error('NEXT_REDIRECT'))
  await expect(criarServico(ini, form(CAMPOS))).rejects.toThrow('NEXT_REDIRECT')
  expect(await prisma.service.count()).toBe(0)
})
