import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TenantContext } from '@/server/auth/actor'
import { verifyPassword } from '@/server/auth/password'
import { prisma } from '@/server/db/client'
import { resetDb } from '../setup/db'
import { ctxWithRole, makeAppointment, makeBusiness, makeCustomer, makeProfessional, makeService, makeUser, memberOf } from '../setup/factories'

const guards = vi.hoisted(() => ({ requireTenant: vi.fn(), readCookie: vi.fn(), APP_COOKIE: 'painel' }))
vi.mock('@/server/auth/guards', () => guards)
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  criarFechamento,
  removerFechamento,
  salvarAvisos,
  salvarNegocio,
  salvarRegras,
} from '@/app/app/painel/configuracoes/actions'

const ini = { ok: false, message: null, fields: {}, values: {} } as never
const NEGADO = 'Você não tem permissão para fazer isso.'
const CONFLITO = 'Alguém mudou estas configurações agora. Recarregue para ver.'

function form(campos: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(campos)) fd.set(k, v)
  return fd
}

let businessId: string
let dono: TenantContext
beforeEach(async () => {
  await resetDb()
  businessId = (await makeBusiness({ timezone: 'America/Manaus' })).id
  dono = await ctxWithRole({ id: businessId }, 'OWNER')
  guards.requireTenant.mockResolvedValue(dono)
  guards.readCookie.mockResolvedValue('token-da-sessao')
})
afterEach(() => {
  guards.requireTenant.mockReset()
  guards.readCookie.mockReset()
})

const config = () => prisma.businessSettings.findUniqueOrThrow({ where: { businessId } })
const REGRAS = { slotStepMin: '15', minLeadMin: '90', maxAdvanceDays: '60', customerChangeWindowMin: '120', bufferMin: '10', autoConfirm: 'on' }

describe('regras da agenda', () => {
  test('grava, repete o verbo na confirmação e sobe a versão', async () => {
    const antes = await config()
    const r = await salvarRegras(ini, form({ ...REGRAS, version: String(antes.version) }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Regras salvas.')
    const depois = await config()
    expect(depois).toMatchObject({ minLeadMin: 90, maxAdvanceDays: 60, bufferMin: 10, autoConfirm: true })
    expect(depois.version).toBe(antes.version + 1)
  })

  test('versão antiga devolve o conflito explicado, mantém o digitado e não grava', async () => {
    const antes = await config()
    const r = await salvarRegras(ini, form({ ...REGRAS, minLeadMin: '777', version: String(antes.version - 1 || 99) }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(CONFLITO)
    expect(r.values.minLeadMin).toBe('777')
    expect((await config()).minLeadMin).toBe(antes.minLeadMin)
  })

  test('regra fora do limite volta como erro do campo, com o digitado', async () => {
    const antes = await config()
    const r = await salvarRegras(ini, form({ ...REGRAS, maxAdvanceDays: '9999', version: String(antes.version) }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields)).toEqual(['maxAdvanceDays'])
    expect(r.values.maxAdvanceDays).toBe('9999')
  })

  test('gerente salva regras; profissional não', async () => {
    const v = (await config()).version
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    expect((await salvarRegras(ini, form({ ...REGRAS, version: String(v) }))).ok).toBe(true)
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    const r = await salvarRegras(ini, form({ ...REGRAS, minLeadMin: '5', version: String(v + 1) }))
    expect(r.message).toBe(NEGADO)
    expect((await config()).minLeadMin).toBe(90)
  })

  test('dois formulários, uma versão: depois de salvar as regras, os avisos pedem a versão nova', async () => {
    const v = (await config()).version
    await salvarRegras(ini, form({ ...REGRAS, version: String(v) }))
    const velha = await salvarAvisos(ini, form({ version: String(v), APPOINTMENT_CONFIRMED__email: 'on' }))
    expect(velha.message).toBe(CONFLITO)
    const nova = await salvarAvisos(ini, form({ version: String(v + 1), APPOINTMENT_CONFIRMED__email: 'on' }))
    expect(nova.ok).toBe(true)
    expect(nova.message).toBe('Avisos salvos.')
  })
})

describe('avisos', () => {
  test('a matriz grava uma caixa de e-mail por tipo; desmarcada desliga', async () => {
    const v = (await config()).version
    const r = await salvarAvisos(ini, form({ version: String(v), APPOINTMENT_CONFIRMED__email: 'on' }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Avisos salvos.')
    const n = (await config()).notifications as Record<string, { email: boolean }>
    expect(n.APPOINTMENT_CONFIRMED).toEqual({ email: true })
    expect(n.APPOINTMENT_CANCELED).toEqual({ email: false })
  })

  test('versão antiga devolve o conflito', async () => {
    const v = (await config()).version
    await salvarAvisos(ini, form({ version: String(v) }))
    const r = await salvarAvisos(ini, form({ version: String(v), APPOINTMENT_CONFIRMED__email: 'on' }))
    expect(r.message).toBe(CONFLITO)
  })
})

describe('negócio', () => {
  test('o dono muda nome e contato; a confirmação repete o verbo', async () => {
    const v = (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).version
    const r = await salvarNegocio(ini, form({ version: String(v), name: 'Pet da Ana', contactEmail: 'oi@petana.test', contactPhone: '11987654321' }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Dados salvos.')
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } })
    expect(b.email).toBe('oi@petana.test')
    expect(b.phone).toBe('5511987654321')
    expect((await prisma.businessBranding.findUniqueOrThrow({ where: { businessId } })).displayName).toBe('Pet da Ana')
  })

  test('gerente em Negócio: sem permissão e nada muda', async () => {
    const antes = await prisma.business.findUniqueOrThrow({ where: { id: businessId } })
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'MANAGER'))
    const r = await salvarNegocio(ini, form({ version: String(antes.version), name: 'Outro nome', contactEmail: '', contactPhone: '' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(NEGADO)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).version).toBe(antes.version)
  })

  test('versão antiga mantém o digitado e orienta a recarregar', async () => {
    const v = (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).version
    await salvarNegocio(ini, form({ version: String(v), name: 'Primeiro', contactEmail: '', contactPhone: '' }))
    const r = await salvarNegocio(ini, form({ version: String(v), name: 'Segundo', contactEmail: 'x@y.test', contactPhone: '' }))
    expect(r.ok).toBe(false)
    expect(r.message).toBe(CONFLITO)
    expect(r.values.name).toBe('Segundo')
    expect(r.values.contactEmail).toBe('x@y.test')
  })
})

describe('aparência', () => {
  test('o dono lê o visual gravado pelo painel dev; gerente não', async () => {
    const { getBusinessAppearance } = await import('@/server/domain/settings/business-profile')
    const a = await getBusinessAppearance(dono)
    expect(a.primary).toMatch(/^#[0-9A-F]{6}$/)
    expect(a.logoUrl).toBeNull()
    await expect(getBusinessAppearance(await ctxWithRole({ id: businessId }, 'MANAGER'))).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('fechamentos', () => {
  const CAMPOS = { startDate: '2026-12-24', endDate: '2026-12-26', reason: 'Recesso' }
  const fechamentos = () => prisma.businessClosure.findMany({ where: { businessId } })

  test('sem agendamentos no intervalo, grava direto', async () => {
    const r = await criarFechamento(ini, form(CAMPOS))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Fechamento criado.')
    expect(await fechamentos()).toHaveLength(1)
  })

  test('com agendamentos no intervalo, o primeiro envio só avisa quantos; só grava com a confirmação da prévia', async () => {
    const servico = await makeService(businessId)
    const prof = await makeProfessional(businessId, { serviceIds: [servico.id] })
    const cliente = await makeCustomer(businessId)
    await makeAppointment(businessId, { customerId: cliente.id, professionalId: prof.id, serviceId: servico.id, startsAt: new Date('2026-12-25T15:00:00Z') })
    const aviso = await criarFechamento(ini, form(CAMPOS))
    expect(aviso.ok).toBe(false)
    expect(aviso.message).toContain('1 agendamento')
    expect(aviso.values.confirm).toBeTruthy()
    expect(await fechamentos()).toHaveLength(0)
    // Confirmação de outro intervalo não vale.
    const outro = await criarFechamento(ini, form({ ...CAMPOS, endDate: '2026-12-27', confirm: aviso.values.confirm ?? '' }))
    expect(outro.ok).toBe(false)
    expect(await fechamentos()).toHaveLength(0)
    const ok = await criarFechamento(ini, form({ ...CAMPOS, confirm: aviso.values.confirm ?? '' }))
    expect(ok.ok).toBe(true)
    expect(await fechamentos()).toHaveLength(1)
  })

  test('datas fora de ordem voltam como erro de campo', async () => {
    const r = await criarFechamento(ini, form({ ...CAMPOS, startDate: '2026-12-30' }))
    expect(r.ok).toBe(false)
    expect(Object.keys(r.fields).length).toBeGreaterThan(0)
  })

  test('remove, e o profissional não cria nem remove', async () => {
    await criarFechamento(ini, form(CAMPOS))
    const [f] = await fechamentos()
    guards.requireTenant.mockResolvedValue(await ctxWithRole({ id: businessId }, 'PROFESSIONAL'))
    expect((await removerFechamento(ini, form({ id: f?.id ?? '' }))).message).toBe(NEGADO)
    expect((await criarFechamento(ini, form({ ...CAMPOS, startDate: '2027-01-02', endDate: '2027-01-03' }))).message).toBe(NEGADO)
    guards.requireTenant.mockResolvedValue(dono)
    const r = await removerFechamento(ini, form({ id: f?.id ?? '' }))
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Fechamento removido.')
    expect(await fechamentos()).toHaveLength(0)
  })
})
