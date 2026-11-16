import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GET as availability } from '@/app/api/v1/availability/route'
import { GET as obterAgendamento } from '@/app/api/v1/appointments/[id]/route'
import { POST as cancelar } from '@/app/api/v1/appointments/[id]/cancel/route'
import { POST as remarcar } from '@/app/api/v1/appointments/[id]/reschedule/route'
import { GET as proximo } from '@/app/api/v1/appointments/next/route'
import { GET as listar, POST as marcar } from '@/app/api/v1/appointments/route'
import { POST as excluirConta } from '@/app/api/v1/me/delete/route'
import { GET as obterMe, PATCH as atualizarMe } from '@/app/api/v1/me/route'
import * as meRoute from '@/app/api/v1/me/route'
import { DELETE as removerDispositivo } from '@/app/api/v1/me/devices/[pushToken]/route'
import { POST as registrarDispositivo } from '@/app/api/v1/me/devices/route'
import { GET as lerAvisos, PUT as gravarAvisos } from '@/app/api/v1/me/notifications/route'
import { PUT as trocarSenha } from '@/app/api/v1/me/password/route'
import { prisma } from '@/server/db/client'
import { loginCustomer } from '@/server/domain/customers/account'
import { addMinutes, toInstant, toIsoInstant } from '@/server/time'
import { apiError, apiRequest, callRoute, jsonObject, staffToken } from '../../setup/api'
import { chavesDe, montarCena, SENHA, totalAgendamentos, type Cena } from '../../setup/api-scene'
import { resetDb } from '../../setup/db'
import { makeAppointment, makeMembership, makeProfessional, makeUser } from '../../setup/factories'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})

let c: Cena

beforeEach(async () => {
  await resetDb()
  c = await montarCena()
})

type Opcoes = Parameters<typeof apiRequest>[2]
const comKey = (o: Opcoes = {}): Opcoes => ({ key: c.key, ...o })

/** Início (ISO UTC) do horário com este rótulo, como a disponibilidade devolve. */
async function inicio(data: string, label: string, profissionalId: string | null = c.ana.id): Promise<string> {
  const p = profissionalId === null ? '' : `&professionalId=${profissionalId}`
  const r = await callRoute(availability, apiRequest('GET', `/v1/availability?date=${data}&serviceIds=${c.banho.id}${p}`, comKey()))
  const slots = jsonObject(r.json).slots as { startsAt: string; label: string }[]
  const slot = slots.find((s) => s.label === label)
  if (!slot) throw new Error(`Sem horário ${label} em ${data}.`)
  return slot.startsAt
}

const corpoMarcar = (startsAt: string, extra: Record<string, unknown> = {}) => ({
  serviceIds: [c.banho.id],
  professionalId: c.ana.id,
  startsAt,
  ...extra,
})

const postar = (token: string, body: unknown, headers: Record<string, string> = {}) =>
  callRoute(marcar, apiRequest('POST', '/v1/appointments', comKey({ token, body, headers })))

const chamar = (
  handler: Parameters<typeof callRoute>[0],
  method: string,
  caminho: string,
  token: string | undefined,
  o: { body?: unknown; params?: Record<string, string>; headers?: Record<string, string> } = {},
) =>
  callRoute(
    handler,
    apiRequest(method, caminho, comKey({ ...(token === undefined ? {} : { token }), ...(o.body === undefined ? {} : { body: o.body }), ...(o.headers ? { headers: o.headers } : {}) })),
    o.params ?? {},
  )

describe('autenticação das rotas do cliente', () => {
  test('sem token: 401; token de equipe: 403', async () => {
    const user = await makeUser()
    const m = await makeMembership(c.business.id, user.id, 'OWNER')
    const equipe = await staffToken(c.business.id, m.id, user.id)
    const rotas: [Parameters<typeof callRoute>[0], string, string][] = [
      [obterMe, 'GET', '/v1/me'],
      [listar, 'GET', '/v1/appointments'],
      [proximo, 'GET', '/v1/appointments/next'],
      [lerAvisos, 'GET', '/v1/me/notifications'],
    ]
    for (const [handler, metodo, caminho] of rotas) {
      expect((await chamar(handler, metodo, caminho, undefined)).status, caminho).toBe(401)
      const r = await chamar(handler, metodo, caminho, equipe)
      expect(r.status, caminho).toBe(403)
      expect(apiError(r.json).reason).toBe('wrong_token_kind')
    }
  })
})

describe('marcar, ler, cancelar e remarcar', () => {
  test('POST /v1/appointments com o horário da disponibilidade: 201, local.start igual ao rótulo e só campos do cliente', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    const r = await postar(c.tokenCliente, corpoMarcar(startsAt, { customerNote: '  Tem medo de secador ' }))
    expect(r.status).toBe(201)
    const json = jsonObject(r.json)
    expect(json).toMatchObject({
      status: 'CONFIRMED',
      source: 'APP',
      startsAt,
      local: { date: c.dia(10), start: '10:00', end: '11:00' },
      totalCents: 8000,
      customerNote: 'Tem medo de secador',
      professional: { id: c.ana.id, name: 'Ana' },
    })
    expect(chavesDe(json).sort()).toEqual(
      [
        'id', 'status', 'source', 'startsAt', 'endsAt',
        'local', 'local.date', 'local.start', 'local.end',
        'customer', 'customer.id', 'customer.name', 'customer.phoneLabel',
        'professional', 'professional.id', 'professional.name',
        'items', 'items[].serviceId', 'items[].name', 'items[].priceCents', 'items[].durationMin',
        'totalCents', 'totalDurationMin', 'customerNote',
        'change', 'change.allowed', 'change.until', 'change.untilLabel',
        'canceledAt', 'cancelReason', 'completedAt',
      ].sort(),
    )
    expect(r.text).not.toContain('commissionCents')
    expect(await totalAgendamentos(c.business.id)).toBe(1)
  })

  test('horário de Manaus: a marcação guarda 13:00:00.000Z e responde 09:00 local', async () => {
    const m = await montarCena({ timeZone: 'America/Manaus' })
    const data = m.dia(10)
    const disp = await callRoute(availability, apiRequest('GET', `/v1/availability?date=${data}&serviceIds=${m.banho.id}`, { key: m.key }))
    const nove = (jsonObject(disp.json).slots as { startsAt: string; label: string }[]).find((s) => s.label === '09:00')
    expect(nove?.startsAt).toBe(`${data}T13:00:00.000Z`)
    const r = await callRoute(marcar, apiRequest('POST', '/v1/appointments', { key: m.key, token: m.tokenCliente, body: { serviceIds: [m.banho.id], startsAt: nove?.startsAt } }))
    expect(r.status).toBe(201)
    expect(jsonObject(r.json)).toMatchObject({ startsAt: `${data}T13:00:00.000Z`, local: { date: data, start: '09:00', end: '10:00' } })
  })

  test('o mesmo pedido de novo sem chave de idempotência: 409 slot_taken', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    expect((await postar(c.tokenCliente, corpoMarcar(startsAt))).status).toBe(201)
    const de_novo = await postar(c.tokenCliente, corpoMarcar(startsAt))
    expect(de_novo.status).toBe(409)
    expect(apiError(de_novo.json)).toMatchObject({ code: 'conflict', reason: 'slot_taken' })
    expect(await totalAgendamentos(c.business.id)).toBe(1)
  })

  test('horário fora da disponibilidade: 409 slot_unavailable', async () => {
    const tresDaManha = toIsoInstant(toInstant(c.dia(10), '03:00', c.business.timezone))
    const r = await postar(c.tokenCliente, corpoMarcar(tresDaManha))
    expect(r.status).toBe(409)
    expect(apiError(r.json).reason).toBe('slot_unavailable')
  })

  test('corpo: campo desconhecido, notas internas, data fora do formato e serviços ausentes: 422', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    for (const extra of [{ notes: 'interna' }, { customerId: c.outro.id }, { foo: 1 }]) {
      expect((await postar(c.tokenCliente, corpoMarcar(startsAt, extra))).status, JSON.stringify(extra)).toBe(422)
    }
    expect((await postar(c.tokenCliente, corpoMarcar('amanhã às 10'))).status).toBe(422)
    expect((await postar(c.tokenCliente, { startsAt })).status).toBe(422)
    expect(await totalAgendamentos(c.business.id)).toBe(0)
  })

  test('GET /v1/appointments/{id}: o dono lê; o outro cliente recebe 404 em ler, cancelar e remarcar', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    const id = String(jsonObject((await postar(c.tokenCliente, corpoMarcar(startsAt))).json).id)
    const meu = await chamar(obterAgendamento, 'GET', `/v1/appointments/${id}`, c.tokenCliente, { params: { id } })
    expect(meu.status).toBe(200)
    expect(jsonObject(meu.json).id).toBe(id)
    const novo = toIsoInstant(addMinutes(new Date(startsAt), 120))
    const alheios = [
      await chamar(obterAgendamento, 'GET', `/v1/appointments/${id}`, c.tokenOutro, { params: { id } }),
      await chamar(cancelar, 'POST', `/v1/appointments/${id}/cancel`, c.tokenOutro, { params: { id } }),
      await chamar(remarcar, 'POST', `/v1/appointments/${id}/reschedule`, c.tokenOutro, { params: { id }, body: { startsAt: novo } }),
    ]
    expect(alheios.map((r) => r.status)).toEqual([404, 404, 404])
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id } })).status).toBe('CONFIRMED')
    const malformado = await chamar(obterAgendamento, 'GET', '/v1/appointments/xyz', c.tokenCliente, { params: { id: 'xyz' } })
    expect(malformado.status).toBe(422)
  })

  test('cancelar dentro do prazo funciona; fora dele: 409 too_late com o prazo na mensagem', async () => {
    const longe = await makeAppointment(c.business.id, {
      customerId: c.cliente.id,
      professionalId: c.ana.id,
      serviceId: c.banho.id,
      startsAt: addMinutes(new Date(), 3 * 24 * 60),
    })
    const ok = await chamar(cancelar, 'POST', `/v1/appointments/${longe.id}/cancel`, c.tokenCliente, { params: { id: longe.id } })
    expect(ok.status).toBe(200)
    expect(jsonObject(ok.json)).toMatchObject({ id: longe.id, status: 'CANCELED' })
    const perto = await makeAppointment(c.business.id, {
      customerId: c.cliente.id,
      professionalId: c.ana.id,
      serviceId: c.banho.id,
      startsAt: addMinutes(new Date(), 60),
    })
    const tarde = await chamar(cancelar, 'POST', `/v1/appointments/${perto.id}/cancel`, c.tokenCliente, { params: { id: perto.id } })
    expect(tarde.status).toBe(409)
    expect(apiError(tarde.json)).toMatchObject({ code: 'conflict', reason: 'too_late' })
    expect(apiError(tarde.json).message).toContain('2 h')
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: perto.id } })).status).toBe('CONFIRMED')
  })

  test('remarcar para outro horário livre: 200 com o novo horário local', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    const id = String(jsonObject((await postar(c.tokenCliente, corpoMarcar(startsAt))).json).id)
    const novo = await inicio(c.dia(10), '14:00')
    const r = await chamar(remarcar, 'POST', `/v1/appointments/${id}/reschedule`, c.tokenCliente, { params: { id }, body: { startsAt: novo } })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ id, startsAt: novo, local: { date: c.dia(10), start: '14:00', end: '15:00' } })
    const fora = await chamar(remarcar, 'POST', `/v1/appointments/${id}/reschedule`, c.tokenCliente, { params: { id }, body: { startsAt: novo, serviceIds: [] } })
    expect(fora.status).toBe(422)
  })
})

describe('idempotência de POST /v1/appointments', () => {
  const KEY = { 'idempotency-key': 'pedido-0001_abc' }

  test('a mesma chave e o mesmo pedido: 200 com o mesmo id, um só agendamento e nenhum aviso novo', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    const primeira = await postar(c.tokenCliente, corpoMarcar(startsAt), KEY)
    expect(primeira.status).toBe(201)
    const avisos = await prisma.notification.count({ where: { businessId: c.business.id } })
    expect(avisos).toBeGreaterThan(0)
    const segunda = await postar(c.tokenCliente, corpoMarcar(startsAt), KEY)
    expect(segunda.status).toBe(200)
    expect(jsonObject(segunda.json).id).toBe(jsonObject(primeira.json).id)
    expect(segunda.json).toEqual(primeira.json)
    expect(await totalAgendamentos(c.business.id)).toBe(1)
    expect(await prisma.notification.count({ where: { businessId: c.business.id } })).toBe(avisos)
    expect(await prisma.auditLog.count({ where: { businessId: c.business.id, action: 'appointment.booked' } })).toBe(1)
  })

  test('a mesma chave com outro horário, outro profissional ou outros serviços: 409 idempotency_key_reused', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    await postar(c.tokenCliente, corpoMarcar(startsAt), KEY)
    const beto = await makeProfessional(c.business.id, { name: 'Beto', serviceIds: [c.banho.id] })
    const outraHora = await inicio(c.dia(10), '11:00')
    const diferentes = [
      corpoMarcar(outraHora),
      corpoMarcar(startsAt, { professionalId: beto.id }),
      corpoMarcar(startsAt, { serviceIds: [c.banho.id, c.inativo.id] }),
    ]
    for (const corpo of diferentes) {
      const r = await postar(c.tokenCliente, corpo, KEY)
      expect(r.status, JSON.stringify(corpo)).toBe(409)
      expect(apiError(r.json)).toMatchObject({ code: 'conflict', reason: 'idempotency_key_reused' })
    }
    expect(await totalAgendamentos(c.business.id)).toBe(1)
  })

  test('a chave é por cliente: outro cliente usa a mesma chave e marca o seu', async () => {
    const dez = await inicio(c.dia(10), '10:00')
    const onze = await inicio(c.dia(10), '11:00')
    expect((await postar(c.tokenCliente, corpoMarcar(dez), KEY)).status).toBe(201)
    expect((await postar(c.tokenOutro, corpoMarcar(onze), KEY)).status).toBe(201)
    expect(await totalAgendamentos(c.business.id)).toBe(2)
  })

  test('chave com mais de 24 horas é liberada: o pedido segue como novo e a chave antiga some', async () => {
    const dez = await inicio(c.dia(10), '10:00')
    const velho = String(jsonObject((await postar(c.tokenCliente, corpoMarcar(dez), KEY)).json).id)
    await prisma.appointment.update({ where: { id: velho }, data: { idempotencyKeyAt: addMinutes(new Date(), -25 * 60) } })
    const onze = await inicio(c.dia(10), '11:00')
    const novo = await postar(c.tokenCliente, corpoMarcar(onze), KEY)
    expect(novo.status).toBe(201)
    expect(jsonObject(novo.json).id).not.toBe(velho)
    const antigo = await prisma.appointment.findUniqueOrThrow({ where: { id: velho } })
    expect(antigo).toMatchObject({ idempotencyKey: null, idempotencyKeyAt: null })
    const atual = await prisma.appointment.findUniqueOrThrow({ where: { id: String(jsonObject(novo.json).id) } })
    expect(atual.idempotencyKey).toBe(KEY['idempotency-key'])
    expect(await totalAgendamentos(c.business.id)).toBe(2)
  })

  test('duas requisições simultâneas com a mesma chave: um agendamento; a perdedora devolve 200 com o mesmo', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    const [a, b] = await Promise.all([postar(c.tokenCliente, corpoMarcar(startsAt), KEY), postar(c.tokenCliente, corpoMarcar(startsAt), KEY)])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(jsonObject(a.json).id).toBe(jsonObject(b.json).id)
    expect(await totalAgendamentos(c.business.id)).toBe(1)
  })

  test('repetir o pedido original depois de remarcar: 200 com o mesmo id (compara com o pedido, não com o estado atual)', async () => {
    const dez = await inicio(c.dia(10), '10:00')
    const id = String(jsonObject((await postar(c.tokenCliente, corpoMarcar(dez), KEY)).json).id)
    const catorze = await inicio(c.dia(10), '14:00')
    const rem = await chamar(remarcar, 'POST', `/v1/appointments/${id}/reschedule`, c.tokenCliente, { params: { id }, body: { startsAt: catorze } })
    expect(rem.status).toBe(200)
    const de_novo = await postar(c.tokenCliente, corpoMarcar(dez), KEY)
    expect(de_novo.status).toBe(200)
    expect(jsonObject(de_novo.json)).toMatchObject({ id, startsAt: catorze })
    expect(await totalAgendamentos(c.business.id)).toBe(1)
  })

  test('repetir o pedido de um agendamento cancelado: 200 com o agendamento cancelado', async () => {
    const dez = await inicio(c.dia(10), '10:00')
    const id = String(jsonObject((await postar(c.tokenCliente, corpoMarcar(dez), KEY)).json).id)
    await chamar(cancelar, 'POST', `/v1/appointments/${id}/cancel`, c.tokenCliente, { params: { id } })
    const de_novo = await postar(c.tokenCliente, corpoMarcar(dez), KEY)
    expect(de_novo.status).toBe(200)
    expect(jsonObject(de_novo.json)).toMatchObject({ id, status: 'CANCELED' })
  })

  test('a mesma chave com outra observação ou com "qualquer profissional" no lugar do pedido original: 409', async () => {
    const dez = await inicio(c.dia(10), '10:00')
    await postar(c.tokenCliente, corpoMarcar(dez, { customerNote: 'Observação A' }), KEY)
    for (const corpo of [corpoMarcar(dez, { customerNote: 'Observação B' }), corpoMarcar(dez), { ...corpoMarcar(dez, { customerNote: 'Observação A' }), professionalId: null }]) {
      const r = await postar(c.tokenCliente, corpo, KEY)
      expect(r.status, JSON.stringify(corpo)).toBe(409)
      expect(apiError(r.json).reason).toBe('idempotency_key_reused')
    }
    const igual = await postar(c.tokenCliente, corpoMarcar(dez, { customerNote: '  Observação A ' }), KEY)
    expect(igual.status).toBe(200)
  })

  test('chave fora do formato: 422 (vazia, com espaço, acento, 81 caracteres); 80 caracteres vale', async () => {
    const startsAt = await inicio(c.dia(10), '10:00')
    for (const ruim of ['', 'com espaço', 'ação-1', 'x'.repeat(81)]) {
      const r = await postar(c.tokenCliente, corpoMarcar(startsAt), { 'idempotency-key': ruim })
      expect(r.status, JSON.stringify(ruim)).toBe(422)
    }
    expect(await totalAgendamentos(c.business.id)).toBe(0)
    expect((await postar(c.tokenCliente, corpoMarcar(startsAt), { 'idempotency-key': 'x'.repeat(80) })).status).toBe(201)
  })

  test('o banco recusa duas chaves iguais do mesmo cliente (índice único parcial), mas aceita sem chave', async () => {
    const base = { customerId: c.cliente.id, professionalId: c.ana.id, serviceId: c.banho.id }
    const a = await makeAppointment(c.business.id, { ...base, startsAt: addMinutes(new Date(), 5 * 24 * 60) })
    const b = await makeAppointment(c.business.id, { ...base, startsAt: addMinutes(new Date(), 6 * 24 * 60) })
    const d = await makeAppointment(c.business.id, { ...base, startsAt: addMinutes(new Date(), 7 * 24 * 60) })
    const marca = { idempotencyKey: 'k1', idempotencyKeyAt: new Date() }
    await prisma.appointment.update({ where: { id: a.id }, data: marca })
    await expect(prisma.appointment.update({ where: { id: b.id }, data: marca })).rejects.toMatchObject({ code: 'P2002' })
    await prisma.appointment.update({ where: { id: d.id }, data: { idempotencyKey: null } })
  })
})

describe('GET /v1/appointments e /next', () => {
  async function tres() {
    const ids: string[] = []
    for (const n of [3, 4, 5]) {
      const a = await makeAppointment(c.business.id, {
        customerId: c.cliente.id,
        professionalId: c.ana.id,
        serviceId: c.banho.id,
        startsAt: toInstant(c.dia(n), '10:00', c.business.timezone),
      })
      ids.push(a.id)
    }
    return ids
  }

  test('pagina os próximos com cursor opaco, limite e ordem estável', async () => {
    const [um, dois, tresId] = await tres()
    const p1 = await chamar(listar, 'GET', '/v1/appointments?scope=upcoming&limit=2', c.tokenCliente)
    expect(p1.status).toBe(200)
    const j1 = jsonObject(p1.json)
    expect((j1.items as { id: string }[]).map((i) => i.id)).toEqual([um, dois])
    expect(typeof j1.nextCursor).toBe('string')
    const p2 = await chamar(listar, 'GET', `/v1/appointments?scope=upcoming&limit=2&cursor=${encodeURIComponent(String(j1.nextCursor))}`, c.tokenCliente)
    const j2 = jsonObject(p2.json)
    expect((j2.items as { id: string }[]).map((i) => i.id)).toEqual([tresId])
    expect(j2.nextCursor).toBeNull()
    expect(p1.text).not.toContain('commissionCents')
  })

  test('o padrão é upcoming com 20 por página; o cliente só vê os próprios', async () => {
    await tres()
    await makeAppointment(c.business.id, {
      customerId: c.outro.id,
      professionalId: c.ana.id,
      serviceId: c.banho.id,
      startsAt: toInstant(c.dia(8), '10:00', c.business.timezone),
    })
    const r = await chamar(listar, 'GET', '/v1/appointments', c.tokenCliente)
    expect((jsonObject(r.json).items as unknown[]).length).toBe(3)
  })

  test('scope=past traz o histórico; parâmetros ruins: 422', async () => {
    await tres()
    const passado = await makeAppointment(c.business.id, {
      customerId: c.cliente.id,
      professionalId: c.ana.id,
      serviceId: c.banho.id,
      startsAt: addMinutes(new Date(), -3 * 24 * 60),
      status: 'COMPLETED',
    })
    const r = await chamar(listar, 'GET', '/v1/appointments?scope=past', c.tokenCliente)
    expect((jsonObject(r.json).items as { id: string }[]).map((i) => i.id)).toEqual([passado.id])
    for (const ruim of ['cursor=lixo', 'limit=0', 'limit=51', 'limit=abc', 'scope=todos', 'x=1']) {
      const resp = await chamar(listar, 'GET', `/v1/appointments?${ruim}`, c.tokenCliente)
      expect(resp.status, ruim).toBe(422)
    }
  })

  test('next: o primeiro agendamento futuro, ou appointment nulo', async () => {
    const vazio = await chamar(proximo, 'GET', '/v1/appointments/next', c.tokenCliente)
    expect(vazio.status).toBe(200)
    expect(vazio.json).toEqual({ appointment: null })
    const [um] = await tres()
    const r = await chamar(proximo, 'GET', '/v1/appointments/next', c.tokenCliente)
    expect(jsonObject(jsonObject(r.json).appointment).id).toBe(um)
  })
})

describe('GET e PATCH /v1/me', () => {
  test('lê o próprio cadastro sem observações internas', async () => {
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { notes: 'nota-interna-do-cliente' } })
    const r = await chamar(obterMe, 'GET', '/v1/me', c.tokenCliente)
    expect(r.status).toBe(200)
    expect(chavesDe(r.json).sort()).toEqual(
      ['archived', 'avatarUrl', 'birthDate', 'createdAt', 'email', 'hasAppAccess', 'id', 'isClubMember', 'name', 'origin', 'phone', 'phoneLabel'].sort(),
    )
    expect(r.text).not.toContain('nota-interna-do-cliente')
    expect(jsonObject(r.json)).toMatchObject({ id: c.cliente.id, name: 'Cliente Um', isClubMember: false })
  })

  test('altera telefone e nome; devolve o rótulo do telefone', async () => {
    const r = await chamar(atualizarMe, 'PATCH', '/v1/me', c.tokenCliente, { body: { phone: '(11) 91234-5678', name: ' Maria Souza ' } })
    expect(r.status).toBe(200)
    expect(jsonObject(r.json)).toMatchObject({ phone: '5511912345678', phoneLabel: '(11) 91234-5678', name: 'Maria Souza' })
  })

  test('notes e isClubMember: 403 e nada muda; campo desconhecido: 422', async () => {
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { notes: 'original' } })
    for (const corpo of [{ notes: 'x' }, { isClubMember: true }, { name: 'Novo', isClubMember: true }]) {
      const r = await chamar(atualizarMe, 'PATCH', '/v1/me', c.tokenCliente, { body: corpo })
      expect(r.status, JSON.stringify(corpo)).toBe(403)
      expect(apiError(r.json).code).toBe('forbidden')
    }
    for (const corpo of [{ foo: 1 }, { hasAppAccess: true }, { email: 'x@y.test' }]) {
      expect((await chamar(atualizarMe, 'PATCH', '/v1/me', c.tokenCliente, { body: corpo })).status, JSON.stringify(corpo)).toBe(422)
    }
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).toMatchObject({ name: 'Cliente Um', notes: 'original', isClubMember: false })
  })
})

describe('senha e exclusão da conta', () => {
  test('PUT /v1/me/password: 204, a nova senha entra e a antiga não; senha atual errada: 403', async () => {
    const errada = await chamar(trocarSenha, 'PUT', '/v1/me/password', c.tokenCliente, { body: { current: 'errada-errada-1', next: 'nova-senha-segura-3' } })
    expect(errada.status).toBe(403)
    expect(apiError(errada.json).reason).toBe('wrong_password')
    const ok = await chamar(trocarSenha, 'PUT', '/v1/me/password', c.tokenCliente, { body: { current: SENHA, next: 'nova-senha-segura-3' } })
    expect(ok.status).toBe(204)
    expect(ok.text).toBe('')
    const meta = { ip: null, userAgent: null }
    expect((await loginCustomer(c.business.id, { email: 'um@exemplo.test', password: 'nova-senha-segura-3' }, meta, new Date())).customerId).toBe(c.cliente.id)
    await expect(loginCustomer(c.business.id, { email: 'um@exemplo.test', password: SENHA }, meta, new Date())).rejects.toThrow()
  })

  test('PUT /v1/me/password com nova senha curta: 422; campo extra: 422', async () => {
    expect((await chamar(trocarSenha, 'PUT', '/v1/me/password', c.tokenCliente, { body: { current: SENHA, next: 'curta' } })).status).toBe(422)
    expect((await chamar(trocarSenha, 'PUT', '/v1/me/password', c.tokenCliente, { body: { current: SENHA, next: 'nova-senha-segura-3', x: 1 } })).status).toBe(422)
  })

  test('não existe mais DELETE /v1/me (corpo em DELETE se perde em clientes e proxies)', () => {
    expect('DELETE' in meRoute).toBe(false)
  })

  test('POST /v1/me/delete com a senha: 204 e o cadastro é anonimizado; senha errada: 403 e nada muda', async () => {
    const errada = await chamar(excluirConta, 'POST', '/v1/me/delete', c.tokenCliente, { body: { password: 'errada-errada-1' } })
    expect(errada.status).toBe(403)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).toBeNull()
    const ok = await chamar(excluirConta, 'POST', '/v1/me/delete', c.tokenCliente, { body: { password: SENHA } })
    expect(ok.status).toBe(204)
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.cliente.id } })).anonymizedAt).not.toBeNull()
    expect((await chamar(obterMe, 'GET', '/v1/me', c.tokenCliente)).status).toBe(401)
  })
})

describe('preferências de aviso', () => {
  test('os padrões do cadastro; gravar e ler de volta', async () => {
    const inicial = await chamar(lerAvisos, 'GET', '/v1/me/notifications', c.tokenCliente)
    expect(inicial.json).toEqual({ pushAppointments: true, emailAppointments: true, pushMarketing: true, emailMarketing: false })
    const novo = { pushAppointments: false, emailAppointments: true, pushMarketing: false, emailMarketing: true }
    const gravado = await chamar(gravarAvisos, 'PUT', '/v1/me/notifications', c.tokenCliente, { body: novo })
    expect(gravado.status).toBe(200)
    expect(gravado.json).toEqual(novo)
    expect((await chamar(lerAvisos, 'GET', '/v1/me/notifications', c.tokenCliente)).json).toEqual(novo)
    expect((await chamar(lerAvisos, 'GET', '/v1/me/notifications', c.tokenOutro)).json).toEqual({
      pushAppointments: true, emailAppointments: true, pushMarketing: true, emailMarketing: false,
    })
  })

  test('corpo incompleto, com texto no lugar de booleano ou com campo extra: 422', async () => {
    const completo = { pushAppointments: true, emailAppointments: true, pushMarketing: true, emailMarketing: true }
    expect((await chamar(gravarAvisos, 'PUT', '/v1/me/notifications', c.tokenCliente, { body: { pushAppointments: true } })).status).toBe(422)
    expect((await chamar(gravarAvisos, 'PUT', '/v1/me/notifications', c.tokenCliente, { body: { ...completo, pushMarketing: 'sim' } })).status).toBe(422)
    expect((await chamar(gravarAvisos, 'PUT', '/v1/me/notifications', c.tokenCliente, { body: { ...completo, extra: true } })).status).toBe(422)
  })
})

describe('dispositivos', () => {
  const TOKEN = 'token-de-push-0123456789'
  const registrar = (token: string, body: unknown) => chamar(registrarDispositivo, 'POST', '/v1/me/devices', token, { body })
  const remover = (token: string, push: string) =>
    chamar(removerDispositivo, 'DELETE', `/v1/me/devices/${encodeURIComponent(push)}`, token, { params: { pushToken: push } })
  const donoDo = async (push: string) => (await prisma.device.findMany({ where: { businessId: c.business.id, pushToken: push } })).map((d) => d.customerId)

  test('registra (204), repete sem duplicar e passa ao último cliente que registrou', async () => {
    expect((await registrar(c.tokenCliente, { platform: 'ios', pushToken: TOKEN })).status).toBe(204)
    expect((await registrar(c.tokenCliente, { platform: 'ios', pushToken: TOKEN })).status).toBe(204)
    expect(await donoDo(TOKEN)).toEqual([c.cliente.id])
    expect((await registrar(c.tokenOutro, { platform: 'android', pushToken: TOKEN })).status).toBe(204)
    expect(await donoDo(TOKEN)).toEqual([c.outro.id])
    expect((await prisma.device.findFirstOrThrow({ where: { pushToken: TOKEN } })).platform).toBe('ANDROID')
  })

  test('dois clientes registrando o mesmo token ao mesmo tempo: um registro só', async () => {
    const par = await Promise.all([
      registrar(c.tokenCliente, { platform: 'web', pushToken: TOKEN }),
      registrar(c.tokenOutro, { platform: 'web', pushToken: TOKEN }),
    ])
    expect(par.map((r) => r.status)).toEqual([204, 204])
    expect(await donoDo(TOKEN)).toHaveLength(1)
  })

  test('apagar o próprio token: 204 e some; o de outro cliente: 204 sem efeito; token desconhecido: 204', async () => {
    await registrar(c.tokenOutro, { platform: 'ios', pushToken: TOKEN })
    expect((await remover(c.tokenCliente, TOKEN)).status).toBe(204)
    expect(await donoDo(TOKEN)).toEqual([c.outro.id])
    expect((await remover(c.tokenCliente, 'token-que-nao-existe-123')).status).toBe(204)
    expect((await remover(c.tokenOutro, TOKEN)).status).toBe(204)
    expect(await donoDo(TOKEN)).toEqual([])
  })

  test('plataforma fora da lista, token curto ou longo demais, campo extra: 422', async () => {
    const ruins = [
      { platform: 'windows', pushToken: TOKEN },
      { platform: 'ios', pushToken: 'curto' },
      { platform: 'ios', pushToken: 'x'.repeat(4097) },
      { platform: 'ios', pushToken: TOKEN, extra: 1 },
      { pushToken: TOKEN },
    ]
    for (const corpo of ruins) expect((await registrar(c.tokenCliente, corpo)).status, JSON.stringify(corpo).slice(0, 60)).toBe(422)
    expect(await prisma.device.count({ where: { businessId: c.business.id } })).toBe(0)
    expect((await registrar(c.tokenCliente, { platform: 'ios', pushToken: 'x'.repeat(4096) })).status).toBe(204)
  })
})

describe('limite de marcações', () => {
  test('a 21ª marcação no minuto: 429; conta por chave e cliente, não só pelo IP', async () => {
    const ruim = { serviceIds: [c.banho.id], startsAt: '2020-01-01T10:00:00.000Z' }
    const ip = (n: string) => ({ 'x-forwarded-for': n })
    for (let i = 0; i < 20; i++) {
      const r = await postar(c.tokenCliente, ruim, ip('203.0.113.7'))
      expect(r.status, `tentativa ${i + 1}`).not.toBe(429)
    }
    const vinteUma = await postar(c.tokenCliente, ruim, ip('203.0.113.7'))
    expect(vinteUma.status).toBe(429)
    expect(vinteUma.headers.get('retry-after')).not.toBeNull()
    // Mesmo cliente por outro IP: continua bloqueado.
    expect((await postar(c.tokenCliente, ruim, ip('203.0.113.99'))).status).toBe(429)
    // Outro cliente pelo mesmo IP: conta própria.
    expect((await postar(c.tokenOutro, ruim, ip('203.0.113.7'))).status).not.toBe(429)
  })
})
