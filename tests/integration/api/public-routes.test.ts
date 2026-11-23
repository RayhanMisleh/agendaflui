import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as availability } from '@/app/api/v1/availability/route'
import { GET as availabilityDays } from '@/app/api/v1/availability/days/route'
import { GET as business } from '@/app/api/v1/business/route'
import { GET as professionals } from '@/app/api/v1/professionals/route'
import { GET as services } from '@/app/api/v1/services/route'
import { prisma } from '@/server/db/client'
import { areaLink } from '@/server/area-links'
import { listProfessionals } from '@/server/domain/team/professionals'
import { requestInstant } from '@/server/api/wire'
import { addDays } from '@/server/time'
import { apiError, apiRequest, callRoute, customerToken, jsonObject, staffToken } from '../../setup/api'
import { chavesDe, montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeCtx, makeMembership, makeProfessional, makeUpload, makeUser } from '../../setup/factories'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena

beforeEach(async () => {
  await resetDb()
  c = await montarCena()
})

const get = (rota: typeof business, caminho: string, o: Parameters<typeof apiRequest>[2] = {}) =>
  callRoute(rota, apiRequest('GET', caminho, { business: c.business.slug, ...o }))

describe('GET /v1/business', () => {
  test('devolve exatamente as chaves públicas, em todos os níveis, e nenhum dado interno', async () => {
    const r = await get(business, '/v1/business')
    expect(r.status).toBe(200)
    expect(chavesDe(r.json).sort()).toEqual(
      [
        'id', 'slug', 'name', 'timeZone',
        'brand', 'brand.logoUrl', 'brand.symbolUrl', 'brand.primary', 'brand.accent', 'brand.material', 'brand.tokens',
        'terms', 'terms.professional', 'terms.professional.singular', 'terms.professional.plural',
        'terms.customer', 'terms.customer.singular', 'terms.customer.plural',
        'terms.points', 'terms.points.singular', 'terms.points.plural', 'terms.club',
        'modules', 'modules.loyalty', 'modules.banners', 'modules.store', 'modules.vouchers',
        'rules', 'rules.slotStepMin', 'rules.minLeadMin', 'rules.maxAdvanceDays', 'rules.customerChangeWindowMin',
      ].sort(),
    )
    for (const proibido of ['12.345.678', 'contato-interno@', '5511999990000', 'internalNotes', 'legalName', 'document', 'passwordHash']) {
      expect(r.text, proibido).not.toContain(proibido)
    }
  })

  test('traz identidade, termos, módulos e regras da conta; tokens são variáveis de tema', async () => {
    await prisma.businessModules.update({ where: { businessId: c.business.id }, data: { loyalty: true } })
    await prisma.businessSettings.update({
      where: { businessId: c.business.id },
      data: { termProfessionalSingular: 'Barbeiro', termProfessionalPlural: 'Barbeiros', termClub: 'Clube Ouro', slotStepMin: 30 },
    })
    await prisma.businessBranding.update({ where: { businessId: c.business.id }, data: { displayName: 'Barbearia Ouro', primaryColor: '#8A2BE2' } })
    const r = await get(business, '/v1/business')
    const json = jsonObject(r.json)
    expect(json).toMatchObject({ id: c.business.id, slug: c.business.slug, name: 'Barbearia Ouro', timeZone: 'America/Sao_Paulo' })
    expect(jsonObject(json.terms)).toMatchObject({
      professional: { singular: 'Barbeiro', plural: 'Barbeiros' },
      customer: { singular: 'Cliente', plural: 'Clientes' },
      points: { singular: 'Ponto', plural: 'Pontos' },
      club: 'Clube Ouro',
    })
    expect(json.modules).toEqual({ loyalty: true, banners: false, store: false, vouchers: false })
    expect(json.rules).toEqual({ slotStepMin: 30, minLeadMin: 60, maxAdvanceDays: 60, customerChangeWindowMin: 120 })
    const brand = jsonObject(json.brand)
    expect(brand).toMatchObject({ primary: '#8A2BE2', logoUrl: null, symbolUrl: null })
    const tokens = jsonObject(brand.tokens)
    expect(Object.keys(tokens).length).toBeGreaterThan(5)
    expect(Object.keys(tokens).every((k) => k.startsWith('--'))).toBe(true)
    expect(Object.values(tokens).every((v) => typeof v === 'string')).toBe(true)
  })

  test('sem chave: 401; conta suspensa: 503', async () => {
    expect((await callRoute(business, apiRequest('GET', '/v1/business'))).status).toBe(401)
    await prisma.business.update({ where: { id: c.business.id }, data: { status: 'SUSPENDED' } })
    expect((await get(business, '/v1/business')).status).toBe(503)
  })

  test('parâmetro de consulta desconhecido: 422', async () => {
    expect((await get(business, '/v1/business?x=1')).status).toBe(422)
  })
})

describe('URLs de arquivo', () => {
  test('pela API, logo, símbolo e avatar saem absolutos no host da API; pelo painel continuam relativos', async () => {
    const logo = await makeUpload(c.business.id)
    const simbolo = await makeUpload(c.business.id)
    const avatar = await makeUpload(c.business.id)
    await prisma.businessBranding.update({ where: { businessId: c.business.id }, data: { logoUploadId: logo.id, symbolUploadId: simbolo.id } })
    await prisma.professional.update({ where: { id: c.ana.id }, data: { avatarUploadId: avatar.id } })
    const base = areaLink('api', '/arquivos/')
    expect(base).toMatch(/^https?:\/\/.+\/arquivos\/$/)
    const b = jsonObject(jsonObject((await get(business, '/v1/business')).json).brand)
    expect(b.logoUrl).toBe(`${base}${logo.path}`)
    expect(b.symbolUrl).toBe(`${base}${simbolo.path}`)
    const p = (jsonObject((await get(professionals, '/v1/professionals')).json).items as { avatarUrl: string }[])[0]
    expect(p?.avatarUrl).toBe(`${base}${avatar.path}`)
    const painel = await makeCtx(c.business)
    expect((await listProfessionals(painel)).find((x) => x.id === c.ana.id)?.avatarUrl).toBe(`/arquivos/${avatar.path}`)
  })

  test('a foto do cliente sai absoluta pelo app', async () => {
    const foto = await makeUpload(c.business.id)
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { avatarUploadId: foto.id } })
    const { GET: me } = await import('@/app/api/v1/me/route')
    const r = await callRoute(me, apiRequest('GET', '/v1/me', { business: c.business.slug, token: c.tokenCliente }))
    expect(jsonObject(r.json).avatarUrl).toBe(`${areaLink('api', '/arquivos/')}${foto.path}`)
  })
})

describe('limite da disponibilidade', () => {
  test('a 61ª consulta no minuto: 429, em /availability e em /availability/days (cada rota com o seu)', async () => {
    const q = `/v1/availability?date=${c.dia(10)}&serviceIds=${c.banho.id}`
    for (let i = 0; i < 60; i++) {
      const r = await get(availability, q)
      expect(r.status, `consulta ${i + 1}`).toBe(200)
    }
    expect((await get(availability, q)).status).toBe(429)
    const from = c.dia(5)
    expect((await get(availabilityDays, `/v1/availability/days?from=${from}&to=${from}&serviceIds=${c.banho.id}`)).status).toBe(200)
  })
})

describe('instantes de entrada', () => {
  test('o esquema de fio diz que só vale UTC com Z', () => {
    expect(requestInstant.description).toMatch(/UTC/)
    expect(requestInstant.description).toMatch(/Z/)
  })
})

describe('GET /v1/services', () => {
  test('lista só os ativos, na ordem da conta, com o contrato do serviço', async () => {
    const r = await get(services, '/v1/services')
    expect(r.status).toBe(200)
    const items = jsonObject(r.json).items as Record<string, unknown>[]
    expect(items.map((i) => i.name)).toEqual(['Banho', 'Corte do clube'])
    expect(items.map((i) => i.id)).not.toContain(c.inativo.id)
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      ['active', 'archived', 'clubOnly', 'description', 'displayOrder', 'durationMin', 'icon', 'id', 'name', 'priceCents', 'rewardPoints'].sort(),
    )
  })

  test('serviço arquivado não aparece', async () => {
    await prisma.service.update({ where: { id: c.banho.id }, data: { archivedAt: new Date() } })
    const items = jsonObject((await get(services, '/v1/services')).json).items as { name: string }[]
    expect(items.map((i) => i.name)).toEqual(['Corte do clube'])
  })
})

describe('GET /v1/professionals', () => {
  test('só os cinco campos públicos: sem comissão, sem vínculo e sem situação interna', async () => {
    const r = await get(professionals, '/v1/professionals')
    expect(r.status).toBe(200)
    const items = jsonObject(r.json).items as Record<string, unknown>[]
    expect(items).toHaveLength(1)
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['avatarUrl', 'bio', 'id', 'name', 'serviceIds'])
    expect(items[0]).toMatchObject({ id: c.ana.id, name: 'Ana', bio: 'Banhos e cortes' })
    expect(r.text).not.toContain('commissionBps')
    expect(r.text).not.toContain('membershipId')
  })

  test('filtra por serviceIds e esconde inativos e arquivados', async () => {
    const soBanho = await makeProfessional(c.business.id, { name: 'Beto', serviceIds: [c.banho.id] })
    await makeProfessional(c.business.id, { name: 'Parado', active: false, serviceIds: [c.banho.id] })
    await makeProfessional(c.business.id, { name: 'Arquivado', archivedAt: new Date(), serviceIds: [c.banho.id] })
    const todos = jsonObject((await get(professionals, '/v1/professionals')).json).items as { name: string }[]
    expect(todos.map((p) => p.name).sort()).toEqual(['Ana', 'Beto'])
    const filtrado = jsonObject((await get(professionals, `/v1/professionals?serviceIds=${c.banho.id},${c.clube.id}`)).json).items as { id: string }[]
    expect(filtrado.map((p) => p.id)).toEqual([c.ana.id])
    expect(soBanho.id).not.toBe(c.ana.id)
  })

  test('serviceIds malformado: 422', async () => {
    expect((await get(professionals, '/v1/professionals?serviceIds=abc')).status).toBe(422)
  })
})

describe('GET /v1/availability', () => {
  const consulta = (c: Cena, data: string, extra = '') =>
    `/v1/availability?date=${data}&serviceIds=${c.banho.id}&professionalId=${c.ana.id}${extra}`

  test('sem token funciona e traz início em ISO UTC com o rótulo local', async () => {
    const data = c.dia(10)
    const r = await get(availability, consulta(c, data))
    expect(r.status).toBe(200)
    const json = jsonObject(r.json)
    expect(json).toMatchObject({ date: data, durationMin: 60, totalCents: 8000 })
    const slots = json.slots as { startsAt: string; label: string; professionalIds: string[] }[]
    expect(slots.length).toBeGreaterThan(10)
    expect(slots[0]).toEqual({ startsAt: `${data}T11:00:00.000Z`, label: '08:00', professionalIds: [c.ana.id] })
  })

  test('conta em Manaus: 09:00 local é 13:00:00.000Z', async () => {
    const m = await montarCena({ timeZone: 'America/Manaus' })
    const data = m.dia(10)
    const r = await callRoute(availability, apiRequest('GET', `/v1/availability?date=${data}&serviceIds=${m.banho.id}`, { business: m.business.slug }))
    expect(r.status).toBe(200)
    const slots = jsonObject(r.json).slots as { startsAt: string; label: string }[]
    const nove = slots.find((s) => s.label === '09:00')
    expect(nove?.startsAt).toBe(`${data}T13:00:00.000Z`)
    expect(slots[0]).toMatchObject({ label: '08:00', startsAt: `${data}T12:00:00.000Z` })
  })

  test('serviço do clube: visitante e cliente comum recebem 403; sócio recebe os horários', async () => {
    const data = c.dia(10)
    const q = `/v1/availability?date=${data}&serviceIds=${c.clube.id}`
    const visitante = await get(availability, q)
    expect(visitante.status).toBe(403)
    expect(apiError(visitante.json)).toMatchObject({ code: 'forbidden', reason: 'club_only' })
    expect((await get(availability, q, { token: c.tokenCliente })).status).toBe(403)
    const socio = await get(availability, q, { token: c.tokenSocio })
    expect(socio.status).toBe(200)
    expect((jsonObject(socio.json).slots as unknown[]).length).toBeGreaterThan(0)
  })

  test('token presente mas ruim nunca vira visitante: inválido 401, de equipe 403, de outra conta 401', async () => {
    const q = consulta(c, c.dia(10))
    const lixo = await get(availability, q, { token: 'lixo' })
    expect(lixo.status).toBe(401)
    expect(apiError(lixo.json).reason).toBe('session_invalid')
    const user = await makeUser()
    const m = await makeMembership(c.business.id, user.id, 'OWNER')
    const equipe = await get(availability, q, { token: await staffToken(c.business.id, m.id, user.id) })
    expect(equipe.status).toBe(403)
    expect(apiError(equipe.json).reason).toBe('wrong_token_kind')
    const outra = await montarCena()
    const cruzado = await get(availability, q, { token: await customerToken(outra.business.id, outra.cliente.id) })
    expect(cruzado.status).toBe(401)
    const basico = await get(availability, q, { headers: { authorization: 'Basic abc' } })
    expect(basico.status).toBe(401)
  })

  test('validações: data ausente, data inválida, serviços ausentes, profissional que não faz o serviço', async () => {
    expect((await get(availability, `/v1/availability?serviceIds=${c.banho.id}`)).status).toBe(422)
    expect((await get(availability, `/v1/availability?date=2026-02-31&serviceIds=${c.banho.id}`)).status).toBe(422)
    expect((await get(availability, `/v1/availability?date=${c.dia(10)}`)).status).toBe(422)
    const parado = await makeProfessional(c.business.id, { name: 'Sem serviço' })
    const r = await get(availability, `/v1/availability?date=${c.dia(10)}&serviceIds=${c.banho.id}&professionalId=${parado.id}`)
    expect(r.status).toBe(422)
    expect(apiError(r.json).fields).toHaveProperty('professionalId')
    expect((await get(availability, `${consulta(c, c.dia(10))}&extra=1`)).status).toBe(422)
  })
})

describe('GET /v1/availability/days', () => {
  test('lista os dias do intervalo, com o dia da semana', async () => {
    const from = c.dia(5)
    const to = addDays(from, 2)
    const r = await get(availabilityDays, `/v1/availability/days?from=${from}&to=${to}&serviceIds=${c.banho.id}`)
    expect(r.status).toBe(200)
    const items = jsonObject(r.json).items as { date: string; weekday: string; available: boolean }[]
    expect(items.map((i) => i.date)).toEqual([from, addDays(from, 1), to])
    expect(items.every((i) => i.available && typeof i.weekday === 'string')).toBe(true)
  })

  test('serviço do clube: 403 para o visitante e 200 para o sócio; intervalo grande demais: 422', async () => {
    const from = c.dia(5)
    const q = `/v1/availability/days?from=${from}&to=${addDays(from, 2)}&serviceIds=${c.clube.id}`
    expect((await get(availabilityDays, q)).status).toBe(403)
    expect((await get(availabilityDays, q, { token: c.tokenSocio })).status).toBe(200)
    const longo = await get(availabilityDays, `/v1/availability/days?from=${from}&to=${addDays(from, 40)}&serviceIds=${c.banho.id}`)
    expect(longo.status).toBe(422)
  })

  test('token ruim: 401 (não rebaixa para visitante)', async () => {
    const from = c.dia(5)
    const r = await get(availabilityDays, `/v1/availability/days?from=${from}&to=${from}&serviceIds=${c.banho.id}`, { token: 'lixo' })
    expect(r.status).toBe(401)
  })
})
