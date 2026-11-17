import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { prisma } from '@/server/db/client'
import { hashPassword } from '@/server/auth/password'
import { listCustomers } from '@/server/domain/customers/customers'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer, makePlatformAdmin } from '../setup/factories'
import { fakeMail } from '../setup/mail'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn() }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', async (original) => {
  const real = await original<typeof import('next/navigation')>()
  return { ...real, redirect: vi.fn((destino: string) => { throw new Error(`NEXT_REDIRECT ${destino}`) }) }
})

import {
  anonimizarCliente,
  arquivarCliente,
  criarCliente,
  editarCliente,
  enviarRedefinicaoCliente,
  restaurarCliente,
} from '@/app/painel/(app)/clientes/actions'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'
const mail = fakeMail()

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness()).id
  dono = await ctxWithRole({ id: businessId }, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
  mail.install()
})
afterEach(() => {
  guards.requireTenant.mockReset()
  mail.uninstall()
})

describe('criar e editar', () => {
  test('cria o cliente com telefone formatado à brasileira e vai para a ficha', async () => {
    await expect(criarCliente(ini, form({ name: 'João Silva', phone: '(11) 91234-5678', email: 'JOAO@exemplo.com' }))).rejects.toThrow(/NEXT_REDIRECT \/clientes\//)
    const c = await prisma.customer.findFirstOrThrow({ where: { businessId } })
    expect(c).toMatchObject({ name: 'João Silva', phone: '5511912345678', email: 'joao@exemplo.com', origin: 'PANEL' })
  })

  test('erro de campo volta no campo certo e mantém o que foi digitado', async () => {
    const r = await criarCliente(ini, form({ name: 'Ana', phone: '12', email: '' }))
    expect(r.ok).toBe(false)
    expect(r.fields.phone).toMatch(/\+/)
    expect(r.values.name).toBe('Ana')
    expect(await prisma.customer.count({ where: { businessId } })).toBe(0)
  })

  test('edita nome, observação e clube', async () => {
    const c = await makeCustomer(businessId, { name: 'Antigo' })
    const r = await editarCliente(ini, form({ id: c.id, name: 'Novo Nome', notes: 'Prefere de manhã', loyalty: '1', isClubMember: 'on' }))
    expect(r.ok).toBe(true)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Novo Nome', notes: 'Prefere de manhã', isClubMember: true })
  })

  test('sem o módulo de fidelidade no formulário, o "do clube" não muda', async () => {
    const c = await makeCustomer(businessId, { name: 'Clubista', isClubMember: true })
    await editarCliente(ini, form({ id: c.id, name: 'Clubista' }))
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).isClubMember).toBe(true)
  })

  test('cliente de outra conta pelo id: não encontrado, e nada muda', async () => {
    const outra = await makeBusiness()
    const alheio = await makeCustomer(outra.id, { name: 'Alheio' })
    for (const r of [
      await editarCliente(ini, form({ id: alheio.id, name: 'Invadido' })),
      await arquivarCliente(ini, form({ id: alheio.id })),
      await anonimizarCliente(ini, form({ id: alheio.id, confirmName: 'Alheio' })),
      await enviarRedefinicaoCliente(ini, form({ id: alheio.id })),
    ]) {
      expect(r.ok).toBe(false)
      expect(r.message).toBe('Cliente não encontrado.')
    }
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: alheio.id } })).toMatchObject({ name: 'Alheio', archivedAt: null, anonymizedAt: null })
  })
})

describe('permissões', () => {
  test('profissional lê os clientes, mas criar e editar são recusados', async () => {
    const c = await makeCustomer(businessId, { name: 'Marina' })
    const prof = await ctxWithRole({ id: businessId }, 'PROFESSIONAL')
    guards.requireTenant.mockResolvedValue(prof)
    expect((await listCustomers(prof)).items.map((i) => i.name)).toEqual(['Marina'])
    for (const r of [
      await criarCliente(ini, form({ name: 'Novo' })),
      await editarCliente(ini, form({ id: c.id, name: 'Troca' })),
      await arquivarCliente(ini, form({ id: c.id })),
      await restaurarCliente(ini, form({ id: c.id })),
      await anonimizarCliente(ini, form({ id: c.id, confirmName: 'Marina' })),
      await enviarRedefinicaoCliente(ini, form({ id: c.id })),
    ]) {
      expect(r.message).toBe(NEGADO)
    }
    expect(await prisma.customer.count({ where: { businessId } })).toBe(1)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Marina', archivedAt: null, anonymizedAt: null })
  })
})

describe('busca e filtros', () => {
  test('"joao" acha "João" e "JOÃO"; e-mail e telefone também', async () => {
    await makeCustomer(businessId, { name: 'João Pedro', email: 'jp@exemplo.com', phone: '5511987654321' })
    await makeCustomer(businessId, { name: 'Maria' })
    const nomes = async (search: string) => (await listCustomers(dono, { search })).items.map((i) => i.name)
    expect(await nomes('joao')).toEqual(['João Pedro'])
    expect(await nomes('JOÃO')).toEqual(['João Pedro'])
    expect(await nomes('jp@exem')).toEqual(['João Pedro'])
    expect(await nomes('98765')).toEqual(['João Pedro'])
  })

  test('arquivados: a lista de ativos não os traz, e o filtro "arquivados" traz só eles', async () => {
    await makeCustomer(businessId, { name: 'Ativo' })
    await makeCustomer(businessId, { name: 'Guardado', archivedAt: new Date() })
    expect((await listCustomers(dono)).items.map((i) => i.name)).toEqual(['Ativo'])
    expect((await listCustomers(dono, { onlyArchived: true })).items.map((i) => i.name)).toEqual(['Guardado'])
  })
})

describe('arquivar e restaurar', () => {
  test('arquiva e restaura', async () => {
    const c = await makeCustomer(businessId, { name: 'Bia' })
    expect((await arquivarCliente(ini, form({ id: c.id }))).ok).toBe(true)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).archivedAt).not.toBeNull()
    expect((await restaurarCliente(ini, form({ id: c.id }))).ok).toBe(true)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).archivedAt).toBeNull()
  })
})

describe('anonimizar', () => {
  test('com o nome errado não anonimiza', async () => {
    const c = await makeCustomer(businessId, { name: 'Carla Dias', email: 'carla@exemplo.com' })
    const r = await anonimizarCliente(ini, form({ id: c.id, confirmName: 'Carla' }))
    expect(r.ok).toBe(false)
    expect(r.fields.confirmName).toBeTruthy()
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Carla Dias', email: 'carla@exemplo.com', anonymizedAt: null })
  })

  test('sem digitar o nome também não anonimiza', async () => {
    const c = await makeCustomer(businessId, { name: 'Carla Dias' })
    expect((await anonimizarCliente(ini, form({ id: c.id }))).ok).toBe(false)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).anonymizedAt).toBeNull()
  })

  test('com o nome certo apaga os dados pessoais', async () => {
    const c = await makeCustomer(businessId, { name: 'Carla Dias', email: 'carla@exemplo.com', notes: 'segredo' })
    const r = await anonimizarCliente(ini, form({ id: c.id, confirmName: 'Carla Dias' }))
    expect(r.ok).toBe(true)
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Cliente removido', email: null, phone: null, notes: null })
  })
})

describe('redefinição de senha do app', () => {
  async function comConta() {
    return makeCustomer(businessId, { name: 'Dani', email: 'dani@exemplo.com', passwordHash: await hashPassword('senha-bem-longa-123') })
  }

  test('o dono manda o código a quem tem conta no app', async () => {
    const c = await comConta()
    const r = await enviarRedefinicaoCliente(ini, form({ id: c.id }))
    expect(r.ok).toBe(true)
    expect(mail.sent.filter((m) => m.to === 'dani@exemplo.com')).toHaveLength(1)
  })

  test('cliente sem conta no app: recusa dizendo o motivo, e nada é enviado', async () => {
    const c = await makeCustomer(businessId, { name: 'Edu', email: 'edu@exemplo.com' })
    const r = await enviarRedefinicaoCliente(ini, form({ id: c.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('conta no app')
    expect(mail.sent).toHaveLength(0)
  })

  test('o suporte (entrando como) é recusado, e nada é enviado', async () => {
    const c = await comConta()
    const admin = await makePlatformAdmin()
    guards.requireTenant.mockResolvedValue(await makeCtx({ id: businessId }, { actor: { kind: 'impersonator', adminId: admin.id, name: admin.name } }))
    const r = await enviarRedefinicaoCliente(ini, form({ id: c.id }))
    expect(r.ok).toBe(false)
    expect(r.message).toContain('suporte')
    expect(mail.sent).toHaveLength(0)
  })
})
