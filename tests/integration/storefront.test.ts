import { beforeEach, describe, expect, test } from 'vitest'
import { prisma } from '@/server/db/client'
import { changeWindowLabel, getStorefront } from '@/server/domain/storefront/storefront'
import { resetDb } from '../setup/db'
import { domainError } from '../setup/expect'
import { ctxWithRole, makeBusiness, makeCtx, makeCustomer, makeService } from '../setup/factories'

beforeEach(resetDb)

async function loja(o: { phone?: string | null } = {}) {
  const b = await makeBusiness({ phone: o.phone === undefined ? '5511912345678' : o.phone, addressLine: 'Rua das Flores, 10', city: 'São Paulo', state: 'SP', document: '12345678000190', email: 'dono@interno.test' })
  const guest = await makeCtx(b, { actor: { kind: 'guest' } })
  return { b, guest }
}

describe('getStorefront', () => {
  test('vitrine traz o preço e a duração dos serviços ativos, na ordem do painel', async () => {
    const { b, guest } = await loja()
    await makeService(b.id, { name: 'Banho', priceCents: 5000, durationMin: 60, description: 'Banho completo', icon: 'bath', displayOrder: 2 })
    await makeService(b.id, { name: 'Tosa', priceCents: 8000, durationMin: 90, clubOnly: true, displayOrder: 1 })
    const v = await getStorefront(guest)
    expect(v.services.map((s) => s.name)).toEqual(['Tosa', 'Banho'])
    expect(v.services[1]).toMatchObject({ name: 'Banho', description: 'Banho completo', icon: 'bath', from: { cents: 5000, varies: false }, durationLabel: '1 h', clubOnly: false })
    expect(v.services[0]).toMatchObject({ durationLabel: '1 h 30', clubOnly: true })
    expect(v.address).toBe('Rua das Flores, 10, São Paulo - SP')
    expect(v.name).toMatch(/^Conta /)
  })

  test('serviço inativo ou arquivado não aparece', async () => {
    const { b, guest } = await loja()
    await makeService(b.id, { name: 'Ativo' })
    await makeService(b.id, { name: 'Inativo', active: false })
    await makeService(b.id, { name: 'Arquivado', archivedAt: new Date() })
    expect((await getStorefront(guest)).services.map((s) => s.name)).toEqual(['Ativo'])
  })

  test('não traz documento, e-mail de contato nem dado interno', async () => {
    const { b, guest } = await loja()
    await makeService(b.id)
    const v = await getStorefront(guest)
    expect(Object.keys(v).sort()).toEqual(['address', 'modules', 'name', 'petNiche', 'phone', 'rules', 'servesCats', 'services'])
    expect(Object.keys(v.services[0] ?? {}).sort()).toEqual(['clubOnly', 'description', 'durationLabel', 'from', 'icon', 'id', 'name'])
    const texto = JSON.stringify(v)
    expect(texto).not.toContain('12345678000190')
    expect(texto).not.toContain('dono@interno.test')
  })

  test('whatsapp só para celular', async () => {
    const { guest } = await loja()
    expect((await getStorefront(guest)).phone).toEqual({ label: '(11) 91234-5678', href: 'tel:+5511912345678', whatsappHref: 'https://wa.me/5511912345678' })
    const fixo = await loja({ phone: '551132345678' })
    expect((await getStorefront(fixo.guest)).phone).toEqual({ label: '(11) 3234-5678', href: 'tel:+551132345678', whatsappHref: null })
    const sem = await loja({ phone: null })
    expect((await getStorefront(sem.guest)).phone).toBeNull()
  })

  test('rótulo do prazo: 120 → "até 2 h antes", 1440 → "até 1 dia antes", 0 → "a qualquer momento"', async () => {
    expect(changeWindowLabel(120)).toBe('até 2 h antes')
    expect(changeWindowLabel(1440)).toBe('até 1 dia antes')
    expect(changeWindowLabel(2880)).toBe('até 2 dias antes')
    expect(changeWindowLabel(90)).toBe('até 1 h 30 antes')
    expect(changeWindowLabel(45)).toBe('até 45 min antes')
    expect(changeWindowLabel(0)).toBe('a qualquer momento')
    const { b, guest } = await loja()
    await prisma.businessSettings.update({ where: { businessId: b.id }, data: { customerChangeWindowMin: 1440 } })
    expect((await getStorefront(guest)).rules).toEqual({ changeWindowMin: 1440, changeWindowLabel: 'até 1 dia antes' })
  })

  test('cliente também lê; membro da equipe → forbidden', async () => {
    const { b, guest } = await loja()
    const c = await makeCustomer(b.id)
    const comoCliente = await makeCtx(b, { actor: { kind: 'customer', customerId: c.id, name: c.name } })
    expect((await getStorefront(comoCliente)).name).toBe((await getStorefront(guest)).name)
    expect((await domainError(getStorefront(await ctxWithRole(b, 'OWNER')))).code).toBe('forbidden')
  })

  test('módulos ligados da loja vêm junto', async () => {
    const { b, guest } = await loja()
    await prisma.businessModules.update({ where: { businessId: b.id }, data: { loyalty: true } })
    expect((await getStorefront(guest)).modules).toMatchObject({ loyalty: true, store: false })
  })
})
