import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { GET as availability } from '@/app/api/v1/availability/route'
import { GET as business } from '@/app/api/v1/business/route'
import { GET as health } from '@/app/api/v1/health/route'
import { GET as openapi } from '@/app/api/v1/openapi.json/route'
import { POST as cancelar } from '@/app/api/v1/appointments/[id]/cancel/route'
import { GET as proximo } from '@/app/api/v1/appointments/next/route'
import { POST as marcar } from '@/app/api/v1/appointments/route'
import { POST as register } from '@/app/api/v1/auth/customer/register/route'
import { POST as verify } from '@/app/api/v1/auth/customer/verify/route'
import { GET as services } from '@/app/api/v1/services/route'
import { prisma } from '@/server/db/client'
import { processDueNotifications } from '@/server/notifications/worker'
import { addDays, addMinutes, todayIn } from '@/server/time'
import { seed, type SeedEnv } from '../../../prisma/seed'
import { apiRequest, callRoute, flushAfter, jsonObject } from '../../setup/api'
import { resetDb } from '../../setup/db'
import { fakeMail } from '../../setup/mail'

// A API roda atrás de um proxy confiável nestes testes: o IP vem do último endereço de X-Forwarded-For.
vi.hoisted(() => {
  process.env.TRUSTED_PROXY_HOPS = '1'
})
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const ENV: SeedEnv = {
  SEED_ADMIN_EMAIL: 'admin@agendaflui.localhost',
  SEED_ADMIN_PASSWORD: 'senha-do-admin-demo',
  SEED_USER_PASSWORD: 'senha-dos-usuarios-demo',
}
// Relógio fixo do seed (quarta-feira, 12:00 em São Paulo). A API usa o relógio real: o dia da marcação é sempre futuro.
const SEED_NOW = new Date('2026-11-18T15:00:00Z')
const EMAIL = 'tutor.fluxo@exemplo.test'
const SENHA = 'senha-muito-segura-1'
const IP = { 'x-forwarded-for': '198.51.100.7' }

const mail = fakeMail()
const SLUG = 'patas-e-cia'
const usadas: string[] = []

beforeAll(async () => {
  await resetDb()
  await seed(prisma, ENV, { now: SEED_NOW })
  // Os avisos da demonstração vencem conforme o relógio real se afasta do SEED_NOW e ocupariam a rodada do worker: o fluxo
  // só confere os avisos que ele mesmo gera.
  await prisma.notification.updateMany({ where: { status: 'PENDING' }, data: { status: 'SKIPPED', skipReason: 'seed' } })
})
afterAll(() => {
  mail.uninstall()
})

type Chamada = { method: string; path: string }
const registrar = (c: Chamada) => usadas.push(`${c.method} ${c.path}`)
const chamar = (
  handler: Parameters<typeof callRoute>[0],
  method: string,
  rota: string,
  o: Parameters<typeof apiRequest>[2] & { params?: Record<string, string>; modelo?: string } = {},
) => {
  registrar({ method, path: o.modelo ?? rota.split('?')[0] ?? rota })
  return callRoute(
    handler,
    apiRequest(method, rota, { business: SLUG, ...o }),
    o.params ?? {},
  )
}

test('fluxo completo: do health ao cancelamento, com avisos', async () => {
  mail.install()
  const agora = () => new Date()
  const canais = { email: mail.channel, push: null }

  // 1. Health (não precisa de conta).
  const saude = await chamar(health, 'GET', '/v1/health')
  expect(saude.status).toBe(200)
  expect(saude.json).toEqual({ status: 'ok' })

  // 2. O cabeçalho X-Business do pet shop devolve os termos da conta.
  const conta = await chamar(business, 'GET', '/v1/business', {})
  expect(conta.status).toBe(200)
  const termos = jsonObject(jsonObject(conta.json).terms)
  expect(jsonObject(termos.professional).singular).toBe('Tosador')
  expect(jsonObject(termos.customer).singular).toBe('Cliente')
  expect(jsonObject(conta.json).slug).toBe('patas-e-cia')

  // 3. Cadastro, código lido do e-mail, confirmação e tokens.
  const cadastro = await chamar(register, 'POST', '/v1/auth/customer/register', {
    headers: IP,
    body: { name: 'Tutor do Fluxo', email: EMAIL, phone: '(11) 91234-5678', password: SENHA },
  })
  expect(cadastro.status).toBe(202)
  await flushAfter()
  expect(mail.sent).toHaveLength(1)
  expect(mail.sent[0]?.to).toBe(EMAIL)
  const confirmacao = await chamar(verify, 'POST', '/v1/auth/customer/verify', { headers: IP, body: { email: EMAIL, code: mail.codeOf() } })
  expect(confirmacao.status).toBe(200)
  const token = String(jsonObject(jsonObject(confirmacao.json).tokens).accessToken)
  expect(token.length).toBeGreaterThan(20)

  // 4. Serviços, disponibilidade de um dia útil futuro e marcação com o primeiro início.
  const lista = await chamar(services, 'GET', '/v1/services', {})
  const itens = jsonObject(lista.json).items as { id: string; name: string; clubOnly: boolean }[]
  const banho = itens.find((s) => s.name === 'Banho' && !s.clubOnly)
  expect(banho).toBeDefined()
  const hoje = todayIn('America/Sao_Paulo', agora())
  let escolha: { data: string; startsAt: string; professionalId: string } | null = null
  for (let n = 3; n <= 14 && escolha === null; n++) {
    const data = addDays(hoje, n)
    const disp = await chamar(availability, 'GET', `/v1/availability?date=${data}&serviceIds=${banho?.id}`, {})
    expect(disp.status).toBe(200)
    const slots = jsonObject(disp.json).slots as { startsAt: string; professionalIds: string[] }[]
    // Um profissional ligado a um acesso recebe o aviso de equipe: é o que o teste confere no fim.
    for (const slot of slots) {
      const ligado = await prisma.professional.findFirst({ where: { id: { in: slot.professionalIds }, membershipId: { not: null } } })
      if (ligado) {
        escolha = { data, startsAt: slot.startsAt, professionalId: ligado.id }
        break
      }
    }
  }
  expect(escolha).not.toBeNull()
  if (escolha === null) return
  const marcado = await chamar(marcar, 'POST', '/v1/appointments', {
    token,
    body: { serviceIds: [banho?.id], professionalId: escolha.professionalId, startsAt: escolha.startsAt },
  })
  expect(marcado.status).toBe(201)
  const agendamento = jsonObject(marcado.json)
  expect(agendamento).toMatchObject({ status: 'CONFIRMED', startsAt: escolha.startsAt })

  // 5. O próximo agendamento é o mesmo.
  const proximoAg = await chamar(proximo, 'GET', '/v1/appointments/next', { token })
  expect(jsonObject(jsonObject(proximoAg.json).appointment).id).toBe(agendamento.id)

  // 6. O worker envia a confirmação ao cliente e o aviso de novo agendamento ao profissional; lembretes ficam na fila.
  const prof = await prisma.professional.findUniqueOrThrow({
    where: { id: escolha.professionalId },
    include: { membership: { include: { user: true } } },
  })
  const emailProf = prof.membership?.user.email ?? ''
  // Roda até esvaziar: avisos antigos do seed vencidos podem ocupar o lote de uma rodada só.
  let falhas = 0
  for (let i = 0; i < 20; i++) {
    const rodada = await processDueNotifications({ now: addMinutes(agora(), 1), channels: canais })
    falhas += rodada.failed
    if (rodada.sent + rodada.skipped + rodada.failed + rodada.retried === 0) break
  }
  expect(falhas).toBe(0)
  const doCliente = mail.sent.filter((m) => m.to === EMAIL)
  expect(doCliente).toHaveLength(2)
  expect(doCliente[0]?.text).toContain(mail.codeOf(0))
  expect(doCliente[1]?.subject).toMatch(/^Agendamento confirmado: Banho em /)
  expect(mail.sent.some((m) => m.to === emailProf && m.subject.startsWith('Novo agendamento: Tutor do Fluxo'))).toBe(true)
  const pendentes = await prisma.notification.findMany({
    where: { appointmentId: String(agendamento.id), kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] } },
  })
  // 24 h e 1 h antes, cada um por e-mail e por push.
  expect(pendentes).toHaveLength(4)
  expect(pendentes.every((n) => n.status === 'PENDING')).toBe(true)

  // 7. Cancelar: a equipe é avisada e os lembretes pendentes deixam de valer, sem sair nenhum.
  const antesDoCancelamento = mail.sent.length
  const cancelado = await chamar(cancelar, 'POST', `/v1/appointments/${agendamento.id}/cancel`, {
    token,
    params: { id: String(agendamento.id) },
    modelo: '/v1/appointments/{id}/cancel',
  })
  expect(cancelado.status).toBe(200)
  expect(jsonObject(cancelado.json)).toMatchObject({ status: 'CANCELED' })
  const rodada2 = await processDueNotifications({ now: addMinutes(agora(), 1), channels: canais })
  expect(rodada2.failed).toBe(0)
  const novos = mail.sent.slice(antesDoCancelamento)
  expect(novos.some((m) => m.to === emailProf && m.subject.startsWith('Agendamento cancelado: Tutor do Fluxo'))).toBe(true)
  expect(novos.some((m) => m.to === EMAIL)).toBe(false)
  const lembretes = await prisma.notification.findMany({
    where: { appointmentId: String(agendamento.id), kind: { in: ['APPOINTMENT_REMINDER_24H', 'APPOINTMENT_REMINDER_1H'] } },
  })
  expect(lembretes).toHaveLength(4)
  expect(lembretes.every((n) => n.status === 'CANCELED')).toBe(true)
  expect(mail.sent.filter((m) => m.subject.startsWith('Lembrete'))).toHaveLength(0)

  // 8. O documento OpenAPI lista todas as rotas usadas acima.
  const doc = await chamar(openapi, 'GET', '/v1/openapi.json')
  expect(doc.status).toBe(200)
  const caminhos = jsonObject(jsonObject(doc.json).paths)
  for (const usada of new Set(usadas)) {
    const [metodo, caminho] = usada.split(' ')
    const item = jsonObject(caminhos[caminho ?? ''])
    expect(item[(metodo ?? '').toLowerCase()], usada).toBeDefined()
  }
})
