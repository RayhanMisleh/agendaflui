import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as agenda } from '@/app/api/v1/staff/agenda/route'
import { POST as ajustar } from '@/app/api/v1/staff/appointments/[id]/adjust/route'
import { POST as cancelar } from '@/app/api/v1/staff/appointments/[id]/cancel/route'
import { POST as concluir } from '@/app/api/v1/staff/appointments/[id]/complete/route'
import { POST as confirmar } from '@/app/api/v1/staff/appointments/[id]/confirm/route'
import { POST as liberarCedo } from '@/app/api/v1/staff/appointments/[id]/free-early/route'
import { POST as faltou } from '@/app/api/v1/staff/appointments/[id]/no-show/route'
import { POST as remarcar } from '@/app/api/v1/staff/appointments/[id]/reschedule/route'
import { GET as obterAgendamento } from '@/app/api/v1/staff/appointments/[id]/route'
import { POST as desfazer } from '@/app/api/v1/staff/appointments/[id]/undo/route'
import { POST as marcar } from '@/app/api/v1/staff/appointments/route'
import { GET as agendamentosDoCliente } from '@/app/api/v1/staff/customers/[id]/appointments/route'
import { GET as obterCliente } from '@/app/api/v1/staff/customers/[id]/route'
import { GET as listarClientes, POST as criarCliente } from '@/app/api/v1/staff/customers/route'
import { DELETE as removerDispositivo } from '@/app/api/v1/staff/devices/[pushToken]/route'
import { POST as registrarDispositivo } from '@/app/api/v1/staff/devices/route'
import { GET as listarProfissionais } from '@/app/api/v1/staff/professionals/route'
import { GET as listarServicos } from '@/app/api/v1/staff/services/route'
import { GET as resumo } from '@/app/api/v1/staff/summary/route'
import { DELETE as apagarBloqueio } from '@/app/api/v1/staff/time-blocks/[id]/route'
import { GET as listarBloqueios, POST as criarBloqueio } from '@/app/api/v1/staff/time-blocks/route'
import { GET as lerExpediente, PUT as gravarExpediente } from '@/app/api/v1/staff/working-hours/[professionalId]/route'
import { POST as registrarDispositivoCliente } from '@/app/api/v1/me/devices/route'
import { ROUTE_MODULES, routeDefinitions } from '@/server/api/routes-manifest'
import { prisma } from '@/server/db/client'
import { addMinutes, toInstant, toIsoInstant } from '@/server/time'
import { apiError, apiRequest, callRoute, jsonObject, staffToken, type CalledRoute } from '../../setup/api'
import { montarCena, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import {
  makeAppointment,
  makeCustomer,
  makeMembership,
  makeProfessional,
  makeUser,
  makeWorkingHours,
} from '../../setup/factories'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

type Pessoa = { token: string; membershipId: string; userId: string }

let c: Cena
let dono: Pessoa
let gerente: Pessoa
let ana: Pessoa
let bia: Pessoa
let biaId: string

async function pessoa(businessId: string, role: 'OWNER' | 'MANAGER' | 'PROFESSIONAL', userId?: string, membershipId?: string): Promise<Pessoa> {
  const uid = userId ?? (await makeUser()).id
  const mid = membershipId ?? (await makeMembership(businessId, uid, role)).id
  return { token: await staffToken(businessId, mid, uid), membershipId: mid, userId: uid }
}

beforeEach(async () => {
  await resetDb()
  c = await montarCena()
  dono = await pessoa(c.business.id, 'OWNER')
  gerente = await pessoa(c.business.id, 'MANAGER')
  const vinculoAna = await prisma.membership.findUniqueOrThrow({ where: { id: c.ana.membershipId ?? '' } })
  ana = await pessoa(c.business.id, 'PROFESSIONAL', vinculoAna.userId, vinculoAna.id)
  bia = await pessoa(c.business.id, 'PROFESSIONAL')
  const profissionalBia = await makeProfessional(c.business.id, {
    name: 'Bia',
    commissionBps: 5000,
    membershipId: bia.membershipId,
    serviceIds: [c.banho.id, c.clube.id],
  })
  biaId = profissionalBia.id
  for (const dia of ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const) {
    await makeWorkingHours(c.business.id, biaId, dia, [{ startMin: 480, endMin: 1080 }])
  }
})

type Opcoes = { body?: unknown; params?: Record<string, string>; headers?: Record<string, string>; query?: string }

function chamar(handler: Parameters<typeof callRoute>[0], metodo: string, caminho: string, quem: Pessoa | string | undefined, o: Opcoes = {}) {
  const token = typeof quem === 'string' ? quem : quem?.token
  return callRoute(
    handler,
    apiRequest(metodo, `${caminho}${o.query ?? ''}`, {
      business: c.business.slug,
      ...(token === undefined ? {} : { token }),
      ...(o.body === undefined ? {} : { body: o.body }),
      ...(o.headers ? { headers: o.headers } : {}),
    }),
    o.params ?? {},
  )
}

const inst = (data: string, hora: string): string => toIsoInstant(toInstant(data, hora, c.business.timezone))

/** Marca pela rota da equipe (gerente) e devolve a resposta. */
function marcarPor(quem: Pessoa, data: string, hora: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return chamar(marcar, 'POST', '/v1/staff/appointments', quem, {
    body: { customerId: c.cliente.id, serviceIds: [c.banho.id], professionalId: c.ana.id, startsAt: inst(data, hora), ...extra },
    headers,
  })
}

async function marcado(data: string, hora: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await marcarPor(gerente, data, hora, extra)
  expect(r.status, r.text).toBe(201)
  return String(jsonObject(r.json).id)
}

const acao = (handler: Parameters<typeof callRoute>[0], quem: Pessoa | string | undefined, id: string, nome: string, body?: unknown) =>
  chamar(handler, 'POST', `/v1/staff/appointments/${id}/${nome}`, quem, { params: { id }, ...(body === undefined ? {} : { body }) })

describe('autenticação', () => {
  test('sem token 401; token de cliente 403 wrong_token_kind em toda rota da equipe', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const rotas = routeDefinitions()
      .filter((d) => d.auth === 'staff')
      .map((d) => ({
        metodo: d.method,
        caminho: d.path.replace(/\{([^}]+)\}/g, (_t, nome: string) => (nome === 'pushToken' ? 'token-qualquer-0123456789' : id)),
        params: Object.fromEntries([...d.path.matchAll(/\{([^}]+)\}/g)].map((m) => [m[1] ?? '', m[1] === 'pushToken' ? 'token-qualquer-0123456789' : id])),
        handler: (Object.values(ROUTE_MODULES).map((m) => m[d.method]).find((h) => (h as { definition?: unknown } | undefined)?.definition === d)) as Parameters<typeof callRoute>[0],
      }))
    expect(rotas.length).toBeGreaterThanOrEqual(25)
    for (const { handler, metodo, caminho, params } of rotas) {
      const sem = await callRoute(handler, apiRequest(metodo, caminho, { business: c.business.slug }), params)
      expect(sem.status, `${metodo} ${caminho} sem token`).toBe(401)
      const cliente = await callRoute(handler, apiRequest(metodo, caminho, { business: c.business.slug, token: c.tokenCliente }), params)
      expect(cliente.status, `${metodo} ${caminho} com token de cliente`).toBe(403)
      expect(apiError(cliente.json).reason).toBe('wrong_token_kind')
    }
  })
})

describe('agenda e resumo', () => {
  test('o gerente vê a agenda de todos; o profissional só a própria coluna; a de um colega é 403', async () => {
    await marcado(c.dia(1), '10:00')
    const consulta = { query: `?from=${c.dia(1)}&to=${c.dia(1)}` }
    const todos = await chamar(agenda, 'GET', '/v1/staff/agenda', gerente, consulta)
    expect(todos.status).toBe(200)
    const dias = jsonObject(todos.json).days as { date: string; professionals: { id: string; appointments: { local: { start: string } }[] }[] }[]
    expect(dias).toHaveLength(1)
    expect(dias[0]?.date).toBe(c.dia(1))
    expect(dias[0]?.professionals.map((p) => p.id).sort()).toEqual([c.ana.id, biaId].sort())
    expect(dias[0]?.professionals.find((p) => p.id === c.ana.id)?.appointments[0]?.local.start).toBe('10:00')

    const propria = await chamar(agenda, 'GET', '/v1/staff/agenda', ana, consulta)
    const colunas = (jsonObject(propria.json).days as { professionals: { id: string }[] }[])[0]?.professionals
    expect(colunas?.map((p) => p.id)).toEqual([c.ana.id])

    const alheia = await chamar(agenda, 'GET', '/v1/staff/agenda', ana, { query: `${consulta.query}&professionalId=${biaId}` })
    expect(alheia.status).toBe(403)
    const filtrada = await chamar(agenda, 'GET', '/v1/staff/agenda', dono, { query: `${consulta.query}&professionalId=${biaId}` })
    expect((jsonObject(filtrada.json).days as { professionals: { id: string }[] }[])[0]?.professionals.map((p) => p.id)).toEqual([biaId])
  })

  test('o profissional não recebe atendimento, comissão nem nota do colega na agenda; o gerente recebe os dois', async () => {
    const idAna = await marcado(c.dia(-1), '10:00', { notes: 'nota secreta da Ana' })
    const idBia = await marcado(c.dia(-1), '12:00', { professionalId: biaId, notes: 'nota da Bia' })
    expect((await acao(concluir, gerente, idAna, 'complete')).status).toBe(200)
    expect((await acao(concluir, gerente, idBia, 'complete')).status).toBe(200)
    const consulta = { query: `?from=${c.dia(-1)}&to=${c.dia(-1)}` }
    type Linha = { id: string; commissionCents: number | null; notes: string | null }
    const colunas = (r: CalledRoute) =>
      (jsonObject(r.json).days as { professionals: { id: string; appointments: Linha[] }[] }[]).flatMap((d) => d.professionals)

    const daBia = await chamar(agenda, 'GET', '/v1/staff/agenda', bia, consulta)
    expect(daBia.status).toBe(200)
    const propria = colunas(daBia).flatMap((p) => p.appointments)
    expect(propria.map((i) => i.id)).toEqual([idBia])
    expect(propria[0]).toMatchObject({ notes: 'nota da Bia' })
    expect(propria[0]?.commissionCents).toEqual(expect.any(Number))
    expect(daBia.text).not.toContain(idAna)
    expect(daBia.text).not.toContain('nota secreta da Ana')

    const doGerente = colunas(await chamar(agenda, 'GET', '/v1/staff/agenda', gerente, consulta)).flatMap((p) => p.appointments)
    expect(doGerente.map((i) => i.id).sort()).toEqual([idAna, idBia].sort())
    for (const item of doGerente) expect(item.commissionCents).toEqual(expect.any(Number))
  })

  test('a agenda usa os mesmos nomes do expediente (start/end e startMin/endMin) e do bloqueio (local com data e hora)', async () => {
    const dia = c.dia(1)
    await prisma.timeBlock.create({
      data: { businessId: c.business.id, professionalId: c.ana.id, startsAt: toInstant(dia, '10:00', c.business.timezone), endsAt: toInstant(dia, '11:00', c.business.timezone), reason: 'Médico', createdByType: 'SYSTEM' },
    })
    const r = await chamar(agenda, 'GET', '/v1/staff/agenda', gerente, { query: `?from=${dia}&to=${dia}` })
    expect(r.status).toBe(200)
    const dias = jsonObject(r.json).days as { professionals: { id: string; workingRanges: unknown[]; blocks: { local: unknown }[] }[] }[]
    const ana = dias[0]?.professionals.find((p) => p.id === c.ana.id)
    expect(ana?.workingRanges[0]).toEqual({ start: '08:00', end: '18:00', startMin: 480, endMin: 1080 })
    expect(ana?.blocks[0]?.local).toEqual({ startDate: dia, startTime: '10:00', endDate: dia, endTime: '11:00' })
  })

  test('a agenda recusa parâmetro que não existe e intervalo inválido', async () => {
    expect((await chamar(agenda, 'GET', '/v1/staff/agenda', gerente, { query: `?from=${c.dia(1)}&to=${c.dia(1)}&x=1` })).status).toBe(422)
    expect((await chamar(agenda, 'GET', '/v1/staff/agenda', gerente, { query: `?from=${c.dia(3)}&to=${c.dia(1)}` })).status).toBe(422)
    expect((await chamar(agenda, 'GET', '/v1/staff/agenda', gerente, { query: '?from=2027-02-30&to=2027-03-01' })).status).toBe(422)
  })

  test('resumo do dia conta os agendamentos', async () => {
    await marcado(c.dia(1), '10:00')
    const r = await chamar(resumo, 'GET', '/v1/staff/summary', gerente, { query: `?date=${c.dia(1)}` })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ total: 1, byStatus: { CONFIRMED: 1, PENDING: 0 }, bookedMinutes: 60 })
    const propria = await chamar(resumo, 'GET', '/v1/staff/summary', bia, { query: `?date=${c.dia(1)}` })
    expect(jsonObject(propria.json).total).toBe(0)
  })
})

describe('marcar e agir sobre agendamentos', () => {
  test('a equipe marca por telefone com o pedido do cliente (customerNote), separado da anotação interna', async () => {
    const r = await marcarPor(gerente, c.dia(2), '09:00', { customerNote: 'Prefere água morna', notes: 'ligou às 8h' })
    expect(r.status, r.text).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({ customerNote: 'Prefere água morna', notes: 'ligou às 8h' })
    const sem = await marcarPor(gerente, c.dia(2), '10:00')
    expect(jsonObject(sem.json).customerNote).toBeNull()
  })

  test('marcar fora da grade: 201, source APP (o canal é o app) e campos da equipe', async () => {
    const r = await marcarPor(gerente, c.dia(2), '07:00', { notes: 'cliente VIP' })
    expect(r.status, r.text).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({
      status: 'CONFIRMED',
      source: 'APP',
      startsAt: inst(c.dia(2), '07:00'),
      local: { date: c.dia(2), start: '07:00', end: '08:00' },
      commissionCents: null,
      notes: 'cliente VIP',
    })
    expect(await prisma.appointment.count({ where: { businessId: c.business.id } })).toBe(1)
  })

  test('sobre agendamento existente: 409 slot_taken com os próximos horários em ISO e com rótulo', async () => {
    await marcado(c.dia(2), '08:00')
    const r = await marcarPor(gerente, c.dia(2), '08:30')
    expect(r.status).toBe(409)
    const erro = apiError(r.json)
    expect(erro).toMatchObject({ code: 'conflict', reason: 'slot_taken' })
    const proximos = erro.details?.nearest as { startsAt: string; label: string }[]
    expect(proximos.length).toBeGreaterThan(0)
    expect(proximos[0]?.startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(proximos[0]?.label).toMatch(/^\d{2}:\d{2}$/)
    expect(await prisma.appointment.count({ where: { businessId: c.business.id } })).toBe(1)
  })

  test('o profissional marca na própria agenda, mas não na de um colega (403)', async () => {
    expect((await marcarPor(ana, c.dia(2), '09:00')).status).toBe(201)
    const r = await chamar(marcar, 'POST', '/v1/staff/appointments', ana, {
      body: { customerId: c.cliente.id, serviceIds: [c.banho.id], professionalId: biaId, startsAt: inst(c.dia(2), '12:00') },
    })
    expect(r.status).toBe(403)
  })

  test('Idempotency-Key: a repetição devolve o mesmo agendamento com 200 e não marca de novo', async () => {
    const chave = { 'idempotency-key': 'equipe-chave-1' }
    const primeira = await marcarPor(gerente, c.dia(2), '10:00', {}, chave)
    const repetida = await marcarPor(gerente, c.dia(2), '10:00', {}, chave)
    expect(primeira.status).toBe(201)
    expect(repetida.status).toBe(200)
    expect(jsonObject(repetida.json).id).toBe(jsonObject(primeira.json).id)
    expect(await prisma.appointment.count({ where: { businessId: c.business.id } })).toBe(1)
    const outro = await marcarPor(gerente, c.dia(2), '12:00', {}, chave)
    expect(outro.status).toBe(409)
    expect(apiError(outro.json).reason).toBe('idempotency_key_reused')
  })

  test('limite de marcações por sujeito: conta por vínculo, qualquer que seja o IP', async () => {
    const barrada = async (quem: Pessoa, n: number) =>
      chamar(marcar, 'POST', '/v1/staff/appointments', quem, { body: {}, headers: { 'x-forwarded-for': `198.51.100.${n}` } })
    for (let i = 1; i <= 20; i++) expect((await barrada(gerente, i)).status).toBe(422)
    const estourou = await barrada(gerente, 99)
    expect(estourou.status).toBe(429)
    expect(estourou.headers.get('retry-after')).not.toBeNull()
    expect((await barrada(dono, 99)).status).toBe(422)
  })

  test('GET do agendamento: a equipe lê; o profissional de outra agenda recebe 403; id malformado é 404', async () => {
    const id = await marcado(c.dia(2), '10:00')
    const ok = await chamar(obterAgendamento, 'GET', `/v1/staff/appointments/${id}`, gerente, { params: { id } })
    expect(ok.status).toBe(200)
    expect(jsonObject(ok.json).id).toBe(id)
    expect((await chamar(obterAgendamento, 'GET', `/v1/staff/appointments/${id}`, bia, { params: { id } })).status).toBe(403)
    expect((await chamar(obterAgendamento, 'GET', '/v1/staff/appointments/x', gerente, { params: { id: 'x' } })).status).toBe(422)
  })

  test('concluir devolve a comissão ao gerente e ao próprio profissional; outro profissional não vê esses atendimentos no histórico do cliente', async () => {
    const idGerente = await marcado(c.dia(-1), '10:00')
    const feito = await acao(concluir, gerente, idGerente, 'complete')
    expect(feito.status, feito.text).toBe(200)
    expect(jsonObject(feito.json)).toMatchObject({ status: 'COMPLETED', commissionCents: 2400 })

    const idAna = await marcado(c.dia(-1), '14:00', { notes: 'só da equipe' })
    const daAna = await acao(concluir, ana, idAna, 'complete')
    expect(jsonObject(daAna.json)).toMatchObject({ status: 'COMPLETED', commissionCents: 2400, notes: 'só da equipe' })

    const outra = await chamar(agendamentosDoCliente, 'GET', `/v1/staff/customers/${c.cliente.id}/appointments`, bia, {
      params: { id: c.cliente.id },
      query: '?scope=past',
    })
    expect(outra.status).toBe(200)
    const itens = jsonObject(outra.json).items as { id: string; commissionCents: number | null; notes: string | null }[]
    expect(itens.map((i) => i.id)).toEqual([])
  })

  test('concluir antes do início: 409 too_early', async () => {
    const id = await marcado(c.dia(3), '10:00')
    const r = await acao(concluir, gerente, id, 'complete')
    expect(r.status).toBe(409)
    expect(apiError(r.json).reason).toBe('too_early')
  })

  test('confirmar, faltar, desfazer e cancelar seguem as regras de situação', async () => {
    const pendente = await makeAppointment(c.business.id, {
      customerId: c.cliente.id,
      professionalId: c.ana.id,
      serviceId: c.banho.id,
      startsAt: toInstant(c.dia(4), '10:00', c.business.timezone),
      status: 'PENDING',
    })
    const confirmado = await acao(confirmar, gerente, pendente.id, 'confirm')
    expect(confirmado.status).toBe(200)
    expect(jsonObject(confirmado.json).status).toBe('CONFIRMED')
    const denovo = await acao(confirmar, gerente, pendente.id, 'confirm')
    expect(denovo.status).toBe(409)
    expect(apiError(denovo.json).reason).toBe('invalid_transition')

    const passado = await marcado(c.dia(-2), '10:00')
    expect(jsonObject((await acao(faltou, gerente, passado, 'no-show')).json).status).toBe('NO_SHOW')
    expect(jsonObject((await acao(desfazer, gerente, passado, 'undo')).json).status).toBe('CONFIRMED')

    const cancelado = await acao(cancelar, gerente, pendente.id, 'cancel', { reason: 'Cliente pediu' })
    expect(cancelado.status).toBe(200)
    expect(jsonObject(cancelado.json)).toMatchObject({ status: 'CANCELED', cancelReason: 'Cliente pediu' })
  })

  test('cancelar sem corpo (corpo opcional) cancela sem motivo; com JSON ruim continua 422', async () => {
    const id = await marcado(c.dia(5), '15:00')
    const ruim = await callRoute(
      cancelar,
      apiRequest('POST', `/v1/staff/appointments/${id}/cancel`, { business: c.business.slug, token: gerente.token, body: '{nao-json', headers: { 'content-type': 'application/json' } }),
      { id },
    )
    expect(ruim.status).toBe(422)
    const r = await acao(cancelar, gerente, id, 'cancel')
    expect(r.status, r.text).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ status: 'CANCELED', cancelReason: null })
  })

  test('remarcar muda o horário e o profissional pelo corpo', async () => {
    const id = await marcado(c.dia(5), '10:00')
    const r = await acao(remarcar, gerente, id, 'reschedule', { startsAt: inst(c.dia(5), '11:00'), professionalId: biaId })
    expect(r.status, r.text).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ local: { start: '11:00' }, professional: { id: biaId } })
    const invalido = await acao(remarcar, gerente, id, 'reschedule', { startsAt: '2027-01-15T10:00:00-03:00' })
    expect(invalido.status).toBe(422)
  })

  test('ajustar: o valor é só de quem vê todas as agendas (profissional 403); a anotação, do profissional', async () => {
    const id = await marcado(c.dia(5), '10:00')
    const valor = await acao(ajustar, ana, id, 'adjust', { totalCents: 100 })
    expect(valor.status).toBe(403)
    const nota = await acao(ajustar, ana, id, 'adjust', { notes: 'trazer produto' })
    expect(nota.status, nota.text).toBe(200)
    expect(jsonObject(nota.json).notes).toBe('trazer produto')
    const gerenteValor = await acao(ajustar, gerente, id, 'adjust', { totalCents: 9500 })
    expect(jsonObject(gerenteValor.json).totalCents).toBe(9500)
  })

  test('free-early duas vezes enfileira um aviso só e devolve 204', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(toInstant(c.dia(0), '09:00', c.business.timezone))
      const donoAgora = await pessoa(c.business.id, 'OWNER')
      const agendamento = await makeAppointment(c.business.id, {
        customerId: c.cliente.id,
        professionalId: c.ana.id,
        serviceId: c.banho.id,
        startsAt: addMinutes(new Date(), 120),
      })
      const primeira = await acao(liberarCedo, donoAgora, agendamento.id, 'free-early')
      const total = () => prisma.notification.count({ where: { businessId: c.business.id, kind: 'PROFESSIONAL_FREE_EARLY' } })
      expect(primeira.status).toBe(204)
      const depoisDaPrimeira = await total()
      expect(depoisDaPrimeira).toBeGreaterThan(0)
      expect((await acao(liberarCedo, donoAgora, agendamento.id, 'free-early')).status).toBe(204)
      expect(await total()).toBe(depoisDaPrimeira)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('clientes', () => {
  test('buscar "joao" acha "João" e a visão da equipe traz a anotação interna', async () => {
    await makeCustomer(c.business.id, { name: 'João Pereira', notes: 'alérgico', searchName: 'joao pereira' })
    const r = await chamar(listarClientes, 'GET', '/v1/staff/customers', gerente, { query: '?search=joao' })
    expect(r.status).toBe(200)
    const itens = jsonObject(r.json).items as { name: string; notes: string | null }[]
    expect(itens.map((i) => i.name)).toEqual(['João Pereira'])
    expect(itens[0]?.notes).toBe('alérgico')
    expect(jsonObject(r.json).nextCursor).toBeNull()
  })

  test('criar cliente: gerente 201 (origem PANEL); profissional 403; detalhe por id', async () => {
    const corpo = { name: 'Maria Souza', phone: '(11) 91234-5678', email: 'maria@exemplo.test', notes: 'prefere manhã' }
    expect((await chamar(criarCliente, 'POST', '/v1/staff/customers', ana, { body: corpo })).status).toBe(403)
    const criado = await chamar(criarCliente, 'POST', '/v1/staff/customers', gerente, { body: corpo })
    expect(criado.status, criado.text).toBe(201)
    const json = jsonObject(criado.json)
    expect(json).toMatchObject({ name: 'Maria Souza', origin: 'PANEL', notes: 'prefere manhã', phone: '5511912345678' })
    const id = String(json.id)
    const lido = await chamar(obterCliente, 'GET', `/v1/staff/customers/${id}`, ana, { params: { id } })
    expect(lido.status).toBe(200)
    expect(jsonObject(lido.json).id).toBe(id)
    const inexistente = '22222222-2222-4222-8222-222222222222'
    expect((await chamar(obterCliente, 'GET', `/v1/staff/customers/${inexistente}`, ana, { params: { id: inexistente } })).status).toBe(404)
  })

  test('agendamentos do cliente: próximos em ordem crescente, com paginação', async () => {
    await marcado(c.dia(2), '10:00')
    await marcado(c.dia(3), '10:00')
    const pagina = await chamar(agendamentosDoCliente, 'GET', `/v1/staff/customers/${c.cliente.id}/appointments`, gerente, {
      params: { id: c.cliente.id },
      query: '?scope=upcoming&limit=1',
    })
    expect(pagina.status).toBe(200)
    const corpo = jsonObject(pagina.json)
    expect((corpo.items as { local: { date: string } }[]).map((i) => i.local.date)).toEqual([c.dia(2)])
    expect(typeof corpo.nextCursor).toBe('string')
  })
})

describe('profissionais e serviços', () => {
  test('o gerente vê a comissão; o profissional vê a própria e zero nas dos colegas', async () => {
    const gerenteLista = await chamar(listarProfissionais, 'GET', '/v1/staff/professionals', gerente)
    const porNome = (r: CalledRoute) => Object.fromEntries((jsonObject(r.json).items as { name: string; commissionBps: number }[]).map((p) => [p.name, p.commissionBps]))
    expect(porNome(gerenteLista)).toEqual({ Ana: 3000, Bia: 5000 })
    const daAna = await chamar(listarProfissionais, 'GET', '/v1/staff/professionals', ana)
    expect(porNome(daAna)).toEqual({ Ana: 3000, Bia: 0 })
  })

  test('serviços: inativos só com includeInactive', async () => {
    const normal = await chamar(listarServicos, 'GET', '/v1/staff/services', ana)
    expect((jsonObject(normal.json).items as { name: string }[]).map((s) => s.name)).toEqual(['Banho', 'Corte do clube'])
    const todos = await chamar(listarServicos, 'GET', '/v1/staff/services', ana, { query: '?includeInactive=true' })
    expect((jsonObject(todos.json).items as { name: string }[]).map((s) => s.name)).toContain('Serviço parado')
  })
})

describe('expediente', () => {
  test('PUT com rótulos HH:mm volta com rótulos e minutos; os outros dias ficam como estavam', async () => {
    const r = await chamar(gravarExpediente, 'PUT', `/v1/staff/working-hours/${c.ana.id}`, gerente, {
      params: { professionalId: c.ana.id },
      body: { MONDAY: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '24:00' }] },
    })
    expect(r.status, r.text).toBe(200)
    const semana = jsonObject(r.json)
    expect(semana.MONDAY).toEqual([
      { start: '09:00', end: '12:00', startMin: 540, endMin: 720 },
      { start: '13:00', end: '24:00', startMin: 780, endMin: 1440 },
    ])
    expect(semana.TUESDAY).toEqual([{ start: '08:00', end: '18:00', startMin: 480, endMin: 1080 }])
    const lido = await chamar(lerExpediente, 'GET', `/v1/staff/working-hours/${c.ana.id}`, ana, { params: { professionalId: c.ana.id } })
    expect(jsonObject(lido.json)).toEqual(semana)
  })

  test("'25:00', formato errado e intervalos sobrepostos viram 422", async () => {
    const enviar = (corpo: unknown) =>
      chamar(gravarExpediente, 'PUT', `/v1/staff/working-hours/${c.ana.id}`, gerente, { params: { professionalId: c.ana.id }, body: corpo })
    const hora = await enviar({ MONDAY: [{ start: '09:00', end: '25:00' }] })
    expect(hora.status).toBe(422)
    expect(apiError(hora.json).fields).toBeDefined()
    expect((await enviar({ MONDAY: [{ start: '9:00', end: '12:00' }] })).status).toBe(422)
    expect((await enviar({ MONDAY: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] })).status).toBe(422)
    expect((await enviar({ FUNDAY: [] })).status).toBe(422)
  })

  test('erros de campo usam os nomes que o app envia (start, end), não os de minutos', async () => {
    const enviar = async (corpo: unknown) => {
      const r = await chamar(gravarExpediente, 'PUT', `/v1/staff/working-hours/${c.ana.id}`, gerente, { params: { professionalId: c.ana.id }, body: corpo })
      expect(r.status).toBe(422)
      return apiError(r.json).fields ?? {}
    }
    expect(await enviar({ MONDAY: [{ start: '12:00', end: '09:00' }] })).toHaveProperty(['MONDAY.0.end'])
    const quebrado = await enviar({ MONDAY: [{ start: '09:03', end: '12:00' }] })
    expect(quebrado).toHaveProperty(['MONDAY.0.start'])
    expect(Object.keys(quebrado).join()).not.toContain('Min')
    expect(await enviar({ MONDAY: [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }] })).toHaveProperty('MONDAY')
  })

  test('o profissional grava o próprio expediente, mas não o de um colega', async () => {
    const proprio = await chamar(gravarExpediente, 'PUT', `/v1/staff/working-hours/${c.ana.id}`, ana, {
      params: { professionalId: c.ana.id },
      body: { SUNDAY: [{ start: '10:00', end: '14:00' }] },
    })
    expect(proprio.status).toBe(200)
    const alheio = await chamar(gravarExpediente, 'PUT', `/v1/staff/working-hours/${biaId}`, ana, {
      params: { professionalId: biaId },
      body: { SUNDAY: [] },
    })
    expect(alheio.status).toBe(403)
  })
})

describe('bloqueios', () => {
  test('em Manaus: grava os instantes certos e devolve affectedAppointments', async () => {
    await resetDb()
    c = await montarCena({ timeZone: 'America/Manaus' })
    const manaus = await pessoa(c.business.id, 'OWNER')
    const dia = c.dia(3)
    await makeAppointment(c.business.id, {
      customerId: c.cliente.id,
      professionalId: c.ana.id,
      serviceId: c.banho.id,
      startsAt: new Date(`${dia}T14:00:00.000Z`),
    })
    const r = await chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', manaus, {
      body: { professionalId: c.ana.id, startDate: dia, startTime: '09:00', endTime: '17:00', reason: 'Médico' },
    })
    expect(r.status, r.text).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({
      professionalId: c.ana.id,
      startsAt: `${dia}T13:00:00.000Z`,
      endsAt: `${dia}T21:00:00.000Z`,
      reason: 'Médico',
      affectedAppointments: 1,
      local: { startDate: dia, startTime: '09:00', endDate: dia, endTime: '17:00' },
    })
  })

  test("endTime '24:00' vai até a meia-noite local; endDate vale o dia de início quando falta", async () => {
    const r = await chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', gerente, {
      body: { professionalId: c.ana.id, startDate: c.dia(3), startTime: '18:00', endTime: '24:00' },
    })
    expect(r.status, r.text).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({ startsAt: inst(c.dia(3), '18:00'), endsAt: inst(c.dia(4), '00:00'), reason: null, affectedAppointments: 0 })
  })

  test('várias datas, fim antes do início e hora inválida', async () => {
    const enviar = (extra: Record<string, unknown>) =>
      chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', gerente, {
        body: { professionalId: c.ana.id, startDate: c.dia(3), startTime: '09:00', endTime: '10:00', ...extra },
      })
    const longo = await enviar({ endDate: c.dia(5), endTime: '12:00' })
    expect(longo.status).toBe(201)
    expect(jsonObject(longo.json).endsAt).toBe(inst(c.dia(5), '12:00'))
    const antes = await enviar({ endTime: '08:00' })
    expect(antes.status).toBe(422)
    expect(apiError(antes.json).fields).toHaveProperty('endTime')
    expect((await enviar({ endTime: '25:00' })).status).toBe(422)
    expect((await enviar({ startTime: '24:00', endDate: c.dia(4), endTime: '10:00' })).status).toBe(422)
    expect((await enviar({ startDate: '2027-02-30' })).status).toBe(422)
  })

  test('fim antes do início e bloqueio longo demais: erro no campo endTime (o nome do app)', async () => {
    const enviar = async (extra: Record<string, unknown>) => {
      const r = await chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', gerente, {
        body: { professionalId: c.ana.id, startDate: c.dia(3), startTime: '09:00', endTime: '10:00', ...extra },
      })
      expect(r.status).toBe(422)
      return apiError(r.json).fields ?? {}
    }
    expect(await enviar({ endTime: '08:00' })).toHaveProperty('endTime')
    const longo = await enviar({ endDate: c.dia(80) })
    expect(longo).toHaveProperty('endTime')
    expect(Object.keys(longo)).not.toContain('endsAt')
  })

  test('listar, apagar e permissões', async () => {
    const criado = await chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', ana, {
      body: { professionalId: c.ana.id, startDate: c.dia(3), startTime: '09:00', endTime: '10:00', reason: 'Dentista' },
    })
    expect(criado.status).toBe(201)
    const id = String(jsonObject(criado.json).id)
    const alheio = await chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', ana, {
      body: { professionalId: biaId, startDate: c.dia(3), startTime: '09:00', endTime: '10:00' },
    })
    expect(alheio.status).toBe(403)

    const consulta = `?professionalId=${c.ana.id}&from=${c.dia(3)}&to=${c.dia(3)}`
    const lista = await chamar(listarBloqueios, 'GET', '/v1/staff/time-blocks', gerente, { query: consulta })
    expect((jsonObject(lista.json).items as { id: string; reason: string }[]).map((b) => [b.id, b.reason])).toEqual([[id, 'Dentista']])
    const doColega = await chamar(listarBloqueios, 'GET', '/v1/staff/time-blocks', bia, { query: consulta })
    expect((jsonObject(doColega.json).items as { reason: string | null }[])[0]?.reason).toBeNull()

    expect((await chamar(apagarBloqueio, 'DELETE', `/v1/staff/time-blocks/${id}`, bia, { params: { id } })).status).toBe(403)
    const apagado = await chamar(apagarBloqueio, 'DELETE', `/v1/staff/time-blocks/${id}`, ana, { params: { id } })
    expect(apagado.status).toBe(204)
    expect((await chamar(apagarBloqueio, 'DELETE', `/v1/staff/time-blocks/${id}`, ana, { params: { id } })).status).toBe(404)
  })
})

describe('dispositivos da equipe', () => {
  const TOKEN = 'token-da-equipe-0123456789'

  test('registrar vincula ao vínculo; o mesmo token passa ao último que registrou; remover só apaga o próprio', async () => {
    const r = await chamar(registrarDispositivo, 'POST', '/v1/staff/devices', gerente, { body: { platform: 'android', pushToken: TOKEN } })
    expect(r.status).toBe(204)
    expect(await prisma.device.findMany({ where: { businessId: c.business.id }, select: { membershipId: true, customerId: true, pushToken: true } })).toEqual([
      { membershipId: gerente.membershipId, customerId: null, pushToken: TOKEN },
    ])

    const troca = await chamar(registrarDispositivo, 'POST', '/v1/staff/devices', dono, { body: { platform: 'ios', pushToken: TOKEN } })
    expect(troca.status).toBe(204)
    const [unico] = await prisma.device.findMany({ where: { businessId: c.business.id } })
    expect(unico).toMatchObject({ membershipId: dono.membershipId, customerId: null, platform: 'IOS' })

    expect((await chamar(removerDispositivo, 'DELETE', `/v1/staff/devices/${TOKEN}`, gerente, { params: { pushToken: TOKEN } })).status).toBe(204)
    expect(await prisma.device.count({ where: { businessId: c.business.id } })).toBe(1)
    expect((await chamar(removerDispositivo, 'DELETE', `/v1/staff/devices/${TOKEN}`, dono, { params: { pushToken: TOKEN } })).status).toBe(204)
    expect(await prisma.device.count({ where: { businessId: c.business.id } })).toBe(0)
  })

  test('o aparelho que muda de equipe para cliente deixa de ser da equipe', async () => {
    await chamar(registrarDispositivo, 'POST', '/v1/staff/devices', gerente, { body: { platform: 'web', pushToken: TOKEN } })
    const cliente = await callRoute(
      registrarDispositivoCliente,
      apiRequest('POST', '/v1/me/devices', { business: c.business.slug, token: c.tokenCliente, body: { platform: 'web', pushToken: TOKEN } }),
    )
    expect(cliente.status).toBe(204)
    const [unico] = await prisma.device.findMany({ where: { businessId: c.business.id } })
    expect(unico).toMatchObject({ membershipId: null, customerId: c.cliente.id })
    expect((await chamar(removerDispositivo, 'DELETE', `/v1/staff/devices/${TOKEN}`, gerente, { params: { pushToken: TOKEN } })).status).toBe(204)
    expect(await prisma.device.count({ where: { businessId: c.business.id } })).toBe(1)
  })

  test('token curto demais: 422', async () => {
    const r = await chamar(registrarDispositivo, 'POST', '/v1/staff/devices', gerente, { body: { platform: 'ios', pushToken: 'curto' } })
    expect(r.status).toBe(422)
  })
})

describe('isolamento entre contas', () => {
  test('com a chave e o token da conta A, ids da conta B dão 404 e nada de B muda', async () => {
    const b = await montarCena()
    const inicio = toInstant(b.dia(3), '10:00', b.business.timezone)
    const agB = await makeAppointment(b.business.id, { customerId: b.cliente.id, professionalId: b.ana.id, serviceId: b.banho.id, startsAt: inicio })
    const bloqueioB = await prisma.timeBlock.create({
      data: { businessId: b.business.id, professionalId: b.ana.id, startsAt: inicio, endsAt: addMinutes(inicio, 60), createdByType: 'SYSTEM' },
    })
    const tokenB = 'token-de-aparelho-da-conta-b-0123'
    await prisma.device.create({ data: { businessId: b.business.id, customerId: b.cliente.id, platform: 'IOS', pushToken: tokenB, lastSeenAt: new Date() } })
    const foto = async () =>
      JSON.stringify([
        await prisma.appointment.findMany({ where: { businessId: b.business.id }, orderBy: { id: 'asc' } }),
        await prisma.timeBlock.findMany({ where: { businessId: b.business.id }, orderBy: { id: 'asc' } }),
        await prisma.workingHours.findMany({ where: { businessId: b.business.id }, orderBy: { id: 'asc' } }),
        await prisma.customer.findMany({ where: { businessId: b.business.id }, orderBy: { id: 'asc' } }),
        await prisma.notification.findMany({ where: { businessId: b.business.id } }),
        await prisma.device.findMany({ where: { businessId: b.business.id } }),
      ])
    const antes = await foto()
    const ag = agB.id

    const acoes: [string, string][] = [
      ['confirm', ''], ['complete', ''], ['no-show', ''], ['undo', ''], ['free-early', ''],
      ['cancel', '{}'], ['reschedule', JSON.stringify({ startsAt: inst(c.dia(4), '10:00') })], ['adjust', JSON.stringify({ notes: 'x' })],
    ]
    const handlers = { confirm: confirmar, complete: concluir, 'no-show': faltou, undo: desfazer, 'free-early': liberarCedo, cancel: cancelar, reschedule: remarcar, adjust: ajustar }
    for (const [nome, corpo] of acoes) {
      const r = await acao(handlers[nome as keyof typeof handlers], gerente, ag, nome, corpo === '' ? undefined : JSON.parse(corpo))
      expect(r.status, nome).toBe(404)
    }
    const lidas: [Parameters<typeof callRoute>[0], string, string, Record<string, string>][] = [
      [obterAgendamento, 'GET', `/v1/staff/appointments/${ag}`, { id: ag }],
      [obterCliente, 'GET', `/v1/staff/customers/${b.cliente.id}`, { id: b.cliente.id }],
      [agendamentosDoCliente, 'GET', `/v1/staff/customers/${b.cliente.id}/appointments`, { id: b.cliente.id }],
      [lerExpediente, 'GET', `/v1/staff/working-hours/${b.ana.id}`, { professionalId: b.ana.id }],
    ]
    for (const [handler, metodo, caminho, params] of lidas) {
      expect((await chamar(handler, metodo, caminho, gerente, { params })).status, caminho).toBe(404)
    }
    const semana = await chamar(gravarExpediente, 'PUT', `/v1/staff/working-hours/${b.ana.id}`, gerente, { params: { professionalId: b.ana.id }, body: { MONDAY: [] } })
    expect(semana.status).toBe(404)
    const lista = await chamar(listarBloqueios, 'GET', '/v1/staff/time-blocks', gerente, { query: `?professionalId=${b.ana.id}&from=${b.dia(3)}&to=${b.dia(3)}` })
    expect(lista.status).toBe(404)
    const apagar = await chamar(apagarBloqueio, 'DELETE', `/v1/staff/time-blocks/${bloqueioB.id}`, gerente, { params: { id: bloqueioB.id } })
    expect(apagar.status).toBe(404)
    const criar = await chamar(criarBloqueio, 'POST', '/v1/staff/time-blocks', gerente, {
      body: { professionalId: b.ana.id, startDate: c.dia(3), startTime: '09:00', endTime: '10:00' },
    })
    expect(criar.status).toBe(404)

    const totalA = await prisma.appointment.count({ where: { businessId: c.business.id } })
    const clienteAlheio = await marcarPor(gerente, c.dia(6), '10:00', { customerId: b.cliente.id })
    expect([404, 422]).toContain(clienteAlheio.status)
    const profissionalAlheio = await marcarPor(gerente, c.dia(6), '10:00', { professionalId: b.ana.id })
    expect([404, 422]).toContain(profissionalAlheio.status)
    expect(clienteAlheio.text + profissionalAlheio.text).not.toContain(b.cliente.name)
    expect(await prisma.appointment.count({ where: { businessId: c.business.id } })).toBe(totalA)

    const removido = await chamar(removerDispositivo, 'DELETE', `/v1/staff/devices/${tokenB}`, gerente, { params: { pushToken: tokenB } })
    expect(removido.status).toBe(204)
    expect(await prisma.device.count({ where: { businessId: b.business.id, pushToken: tokenB } })).toBe(1)

    expect(await foto()).toBe(antes)
  })
})

describe('rotas da equipe no manifesto', () => {
  test('todo caminho /v1/staff/* pede token da equipe; as rotas de entrada /v1/auth/staff/* só a conta', () => {
    const defs = routeDefinitions()
    const staff = defs.filter((d) => d.path.startsWith('/v1/staff/'))
    expect(staff.length).toBeGreaterThanOrEqual(25)
    for (const d of staff) expect(d.auth, `${d.method} ${d.path}`).toBe('staff')
    for (const d of defs.filter((x) => x.path.startsWith('/v1/auth/staff/'))) {
      expect(['guest', 'staff'], `${d.method} ${d.path}`).toContain(d.auth)
    }
  })
})
