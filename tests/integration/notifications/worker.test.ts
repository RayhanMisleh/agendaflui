import { prisma } from '@/server/db/client'
import type { NotificationKind } from '@/server/db/generated/client'
import type { EmailMessage, PushMessage } from '@/server/notifications/channels/types'
import { processDueNotifications } from '@/server/notifications/worker'
import { addMinutes } from '@/server/time'
import { seed, type SeedEnv } from '../../../prisma/seed'
import { resetDb } from '../../setup/db'
import { makeAppointment, makeBusiness, makeCustomer, makeMembership, makeProfessional, makeService, makeUser } from '../../setup/factories'

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })
beforeEach(resetDb)

/** Segunda-feira, 12:00 em Manaus. */
const AGORA = new Date('2026-11-16T16:00:00Z')

type Fake = {
  emails: EmailMessage[]
  pushes: PushMessage[]
  channels: { email: { send(m: EmailMessage): Promise<void> } | null; push: { send(m: PushMessage): Promise<{ invalidTokens: string[] }> } | null }
  failEmail: Error | null
  invalid: string[]
}

function fake(): Fake {
  const f: Fake = {
    emails: [],
    pushes: [],
    failEmail: null,
    invalid: [],
    channels: {
      email: {
        async send(m) {
          if (f.failEmail) throw f.failEmail
          f.emails.push(m)
        },
      },
      push: {
        async send(m) {
          f.pushes.push(m)
          return { invalidTokens: m.tokens.filter((t) => f.invalid.includes(t)) }
        },
      },
    },
  }
  return f
}

async function cena(o: { inicio?: Date } = {}) {
  const business = await makeBusiness({ timezone: 'America/Manaus', name: 'Tosa & Cia' })
  await prisma.businessBranding.update({ where: { businessId: business.id }, data: { displayName: 'Tosa & Cia' } })
  await prisma.businessSettings.update({ where: { businessId: business.id }, data: { termProfessionalSingular: 'Tosador' } })
  const servico = await makeService(business.id, { name: 'Banho', priceCents: 8000 })
  const user = await makeUser({ name: 'Ana Prof', email: 'ana@exemplo.test' })
  const vinculo = await makeMembership(business.id, user.id, 'PROFESSIONAL')
  const prof = await makeProfessional(business.id, { name: 'Ana', membershipId: vinculo.id, serviceIds: [servico.id] })
  const cliente = await makeCustomer(business.id, { name: 'Maria Souza', email: 'maria@exemplo.test' })
  const inicio = o.inicio ?? addMinutes(AGORA, 180)
  const agendamento = await makeAppointment(business.id, { customerId: cliente.id, professionalId: prof.id, serviceId: servico.id, startsAt: inicio })
  return { business, servico, user, vinculo, prof, cliente, agendamento, inicio }
}

type Cena = Awaited<ReturnType<typeof cena>>

async function aviso(c: Cena, o: { kind?: NotificationKind; channel?: 'EMAIL' | 'PUSH'; scheduledFor?: Date; key?: string; membership?: boolean } = {}) {
  const kind = o.kind ?? 'APPOINTMENT_CONFIRMED'
  const channel = o.channel ?? 'EMAIL'
  return prisma.notification.create({
    data: {
      businessId: c.business.id,
      kind,
      channel,
      ...(o.membership ? { membershipId: c.vinculo.id } : { customerId: c.cliente.id }),
      appointmentId: c.agendamento.id,
      scheduledFor: o.scheduledFor ?? addMinutes(AGORA, -1),
      payload: { appointmentId: c.agendamento.id, startsAt: c.agendamento.startsAt.toISOString() },
      dedupeKey: o.key ?? `${kind}:${channel}:${c.agendamento.id}`,
    },
  })
}

const reload = (id: string) => prisma.notification.findUniqueOrThrow({ where: { id } })

describe('processDueNotifications', () => {
  test('envia o confirmado, grava SENT e sentAt, e não manda de novo na rodada seguinte', async () => {
    const c = await cena()
    const n = await aviso(c)
    const f = fake()
    const r = await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(r).toEqual({ sent: 1, skipped: 0, failed: 0, retried: 0 })
    expect(f.emails).toHaveLength(1)
    expect(f.emails[0]).toMatchObject({ to: 'maria@exemplo.test', fromName: 'Tosa & Cia' })
    expect(f.emails[0]!.subject).toBe('Agendamento confirmado: Banho em 16/11/2026 às 15:00')
    expect(f.emails[0]!.text).toContain('Tosador: Ana')
    const depois = await reload(n.id)
    expect(depois).toMatchObject({ status: 'SENT', attempts: 0, lastError: null, lockedUntil: null })
    expect(depois.sentAt?.getTime()).toBe(AGORA.getTime())

    const de_novo = await processDueNotifications({ now: addMinutes(AGORA, 10), channels: f.channels })
    expect(de_novo).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 0 })
    expect(f.emails).toHaveLength(1)
  })

  test('push vai para os dispositivos do cliente, com título, texto e dados', async () => {
    const c = await cena()
    await prisma.device.createMany({
      data: ['t1', 't2'].map((t) => ({ businessId: c.business.id, customerId: c.cliente.id, platform: 'IOS' as const, pushToken: `ExponentPushToken[${t}]`, lastSeenAt: AGORA })),
    })
    const n = await aviso(c, { channel: 'PUSH' })
    const f = fake()
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(f.pushes).toHaveLength(1)
    expect([...f.pushes[0]!.tokens].sort()).toEqual(['ExponentPushToken[t1]', 'ExponentPushToken[t2]'])
    expect(f.pushes[0]!.data).toMatchObject({ kind: 'APPOINTMENT_CONFIRMED', appointmentId: c.agendamento.id })
    expect((await reload(n.id)).status).toBe('SENT')
  })

  test('aviso para a equipe usa o e-mail do usuário do vínculo', async () => {
    const c = await cena()
    await aviso(c, { kind: 'STAFF_NEW_APPOINTMENT', membership: true })
    const f = fake()
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(f.emails.map((e) => e.to)).toEqual(['ana@exemplo.test'])
  })

  test('regra de descarte vira SKIPPED com o motivo, sem enviar', async () => {
    const c = await cena()
    await prisma.appointment.update({ where: { id: c.agendamento.id }, data: { status: 'CANCELED' } })
    const n = await aviso(c)
    const f = fake()
    expect(await processDueNotifications({ now: AGORA, channels: f.channels })).toEqual({ sent: 0, skipped: 1, failed: 0, retried: 0 })
    expect(await reload(n.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'stale', lockedUntil: null })
    expect(f.emails).toEqual([])
  })

  test('recarrega do banco: e-mail trocado depois de enfileirar vale o novo, e cliente arquivado não recebe', async () => {
    const c = await cena()
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { email: 'novo@exemplo.test' } })
    const n = await aviso(c)
    const f = fake()
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(f.emails.map((e) => e.to)).toEqual(['novo@exemplo.test'])
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { archivedAt: AGORA } })
    const outro = await aviso(c, { kind: 'APPOINTMENT_REQUESTED', key: 'x' })
    await prisma.appointment.update({ where: { id: c.agendamento.id }, data: { status: 'PENDING' } })
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(await reload(outro.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'recipient_gone' })
    expect((await reload(n.id)).status).toBe('SENT')
  })

  test('falha do canal: nova tentativa em 1, 5, 15 e 60 minutos; na 5ª falha vira FAILED, sem expor a mensagem do provedor', async () => {
    const c = await cena()
    const n = await aviso(c)
    const f = fake()
    f.failEmail = new Error('550 maria@exemplo.test rejeitado pelo servidor')
    const esperas = [1, 5, 15, 60]
    let agora = AGORA
    for (const [i, espera] of esperas.entries()) {
      const r = await processDueNotifications({ now: agora, channels: f.channels })
      expect(r).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 1 })
      const linha = await reload(n.id)
      expect(linha).toMatchObject({ status: 'PENDING', attempts: i + 1, lastError: 'channel_error', lockedUntil: null })
      expect(linha.nextAttemptAt?.getTime()).toBe(addMinutes(agora, espera).getTime())
      expect(linha.scheduledFor.getTime()).toBe(addMinutes(AGORA, -1).getTime())
      // antes da hora, nada acontece
      expect(await processDueNotifications({ now: addMinutes(agora, espera - 1), channels: f.channels })).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 0 })
      agora = addMinutes(agora, espera)
    }
    expect(await processDueNotifications({ now: agora, channels: f.channels })).toEqual({ sent: 0, skipped: 0, failed: 1, retried: 0 })
    const fim = await reload(n.id)
    expect(fim).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'channel_error' })
    expect(fim.scheduledFor.getTime()).toBe(addMinutes(AGORA, -1).getTime())
    expect(JSON.stringify(fim)).not.toContain('maria@exemplo.test')
    expect(await processDueNotifications({ now: addMinutes(agora, 500), channels: f.channels })).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 0 })
  })

  test('depois de uma falha, o sucesso na tentativa seguinte marca SENT', async () => {
    const c = await cena()
    const n = await aviso(c)
    const f = fake()
    f.failEmail = new Error('x')
    await processDueNotifications({ now: AGORA, channels: f.channels })
    f.failEmail = null
    await processDueNotifications({ now: addMinutes(AGORA, 1), channels: f.channels })
    expect(await reload(n.id)).toMatchObject({ status: 'SENT', attempts: 1, lastError: null })
    expect(f.emails).toHaveLength(1)
  })

  test('canal não configurado: FAILED not_configured de uma vez, sem nova tentativa', async () => {
    const c = await cena()
    const n = await aviso(c)
    expect(await processDueNotifications({ now: AGORA, channels: { email: null, push: null } })).toEqual({ sent: 0, skipped: 0, failed: 1, retried: 0 })
    expect(await reload(n.id)).toMatchObject({ status: 'FAILED', lastError: 'not_configured', attempts: 1 })
  })

  test('destinatário de e-mail inválido: FAILED invalid_recipient sem nova tentativa', async () => {
    const c = await cena()
    await prisma.customer.update({ where: { id: c.cliente.id }, data: { email: 'a@b.c, d@e.f' } })
    const n = await aviso(c)
    const f = fake()
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(await reload(n.id)).toMatchObject({ status: 'FAILED', lastError: 'invalid_recipient' })
    expect(f.emails).toEqual([])
  })

  test('token de push inválido devolvido pelo canal é apagado dos aparelhos', async () => {
    const c = await cena()
    await prisma.device.createMany({
      data: ['bom', 'ruim'].map((t) => ({ businessId: c.business.id, customerId: c.cliente.id, platform: 'ANDROID' as const, pushToken: `ExponentPushToken[${t}]`, lastSeenAt: AGORA })),
    })
    const n = await aviso(c, { channel: 'PUSH' })
    const f = fake()
    f.invalid = ['ExponentPushToken[ruim]']
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect((await prisma.device.findMany()).map((d) => d.pushToken)).toEqual(['ExponentPushToken[bom]'])
    expect((await reload(n.id)).status).toBe('SENT')
  })

  test('se todos os tokens eram inválidos, nada chegou: SKIPPED no_device', async () => {
    const c = await cena()
    await prisma.device.create({ data: { businessId: c.business.id, customerId: c.cliente.id, platform: 'IOS', pushToken: 'ExponentPushToken[ruim]', lastSeenAt: AGORA } })
    const n = await aviso(c, { channel: 'PUSH' })
    const f = fake()
    f.invalid = ['ExponentPushToken[ruim]']
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(await reload(n.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'no_device' })
    expect(await prisma.device.count()).toBe(0)
  })

  test('token de outra conta nunca é apagado', async () => {
    const c = await cena()
    const outra = await makeBusiness()
    const alheio = await makeCustomer(outra.id)
    await prisma.device.create({ data: { businessId: outra.id, customerId: alheio.id, platform: 'IOS', pushToken: 'ExponentPushToken[ruim]', lastSeenAt: AGORA } })
    await prisma.device.create({ data: { businessId: c.business.id, customerId: c.cliente.id, platform: 'IOS', pushToken: 'ExponentPushToken[ruim]', lastSeenAt: AGORA } })
    await aviso(c, { channel: 'PUSH' })
    const f = fake()
    f.invalid = ['ExponentPushToken[ruim]']
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(await prisma.device.count({ where: { businessId: outra.id } })).toBe(1)
  })

  test('duas rodadas simultâneas enviam cada linha uma única vez', async () => {
    const c = await cena()
    for (let i = 0; i < 12; i += 1) await aviso(c, { key: `k${i}` })
    const f = fake()
    const lento = { ...f.channels, email: { async send(m: EmailMessage) { await new Promise((ok) => setTimeout(ok, 5)); f.emails.push(m) } } }
    const [a, b] = await Promise.all([
      processDueNotifications({ now: AGORA, channels: lento }),
      processDueNotifications({ now: AGORA, channels: lento }),
    ])
    expect(a.sent + b.sent).toBe(12)
    expect(f.emails).toHaveLength(12)
    expect(await prisma.notification.count({ where: { status: 'SENT' } })).toBe(12)
  })

  test('se outro processo assumiu a linha durante o envio, o resultado é descartado sem erro', async () => {
    const c = await cena()
    const n = await aviso(c)
    const f = fake()
    const roubado = {
      ...f.channels,
      email: {
        async send(m: EmailMessage) {
          f.emails.push(m)
          await prisma.notification.update({ where: { id: n.id }, data: { lockedBy: 'outro-processo', lockedUntil: addMinutes(AGORA, 5) } })
        },
      },
    }
    expect(await processDueNotifications({ now: AGORA, channels: roubado })).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 0 })
    expect(await reload(n.id)).toMatchObject({ status: 'PENDING', lockedBy: 'outro-processo' })
  })

  test('reserva que venceu antes do envio não envia (nunca duas rodadas na mesma linha)', async () => {
    const c = await cena()
    const n = await aviso(c)
    const f = fake()
    // outro processo reserva a linha entre a reserva desta rodada e o envio: a renovação falha e nada sai
    const antes = { ...f.channels }
    const original = prisma.notification.updateMany.bind(prisma.notification)
    let primeira = true
    const espiao = vi.spyOn(prisma.notification, 'updateMany').mockImplementation((async (args: Parameters<typeof original>[0]) => {
      if (primeira) {
        primeira = false
        await original({ where: { id: n.id }, data: { lockedBy: 'outro-processo', lockedUntil: addMinutes(AGORA, 5) } })
      }
      return original(args)
    }) as unknown as typeof original)
    try {
      await processDueNotifications({ now: AGORA, channels: antes })
    } finally {
      espiao.mockRestore()
    }
    expect(f.emails).toEqual([])
    expect(await reload(n.id)).toMatchObject({ status: 'PENDING', lockedBy: 'outro-processo' })
  })

  test('uma exceção qualquer do canal numa linha não derruba a rodada: a linha conta a falha e as outras seguem', async () => {
    const c = await cena()
    const n = await aviso(c, { key: 'a' })
    const m = await aviso(c, { key: 'b', scheduledFor: addMinutes(AGORA, -2) })
    const f = fake()
    let chamadas = 0
    const channels = {
      ...f.channels,
      email: {
        async send(msg: EmailMessage) {
          chamadas += 1
          if (chamadas === 1) throw new TypeError('bug')
          f.emails.push(msg)
        },
      },
    }
    const r = await processDueNotifications({ now: AGORA, channels })
    expect(r).toEqual({ sent: 1, skipped: 0, failed: 0, retried: 1 })
    expect(await reload(m.id)).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'channel_error' })
    expect((await reload(n.id)).status).toBe('SENT')
  })

  test('conta suspensa e tipo desligado pela conta não enviam', async () => {
    const c = await cena()
    const n = await aviso(c)
    await prisma.business.update({ where: { id: c.business.id }, data: { status: 'SUSPENDED' } })
    const f = fake()
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(await reload(n.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'business_inactive' })
    await prisma.business.update({ where: { id: c.business.id }, data: { status: 'ACTIVE' } })
    await prisma.businessSettings.update({ where: { businessId: c.business.id }, data: { notifications: { APPOINTMENT_REQUESTED: { email: false } } } })
    await prisma.appointment.update({ where: { id: c.agendamento.id }, data: { status: 'PENDING' } })
    const p = await aviso(c, { kind: 'APPOINTMENT_REQUESTED', key: 'req' })
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(await reload(p.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'disabled_by_business' })
    expect(f.emails).toEqual([])
  })

  test('lembrete de 1 h com 4 falhas: na rodada seguinte já passou do prazo e não sai; o horário previsto não muda', async () => {
    const c = await cena({ inicio: addMinutes(AGORA, 60) })
    const previsto = AGORA
    const n = await aviso(c, { kind: 'APPOINTMENT_REMINDER_1H', scheduledFor: previsto })
    const f = fake()
    let chamadas = 0
    const channels = { ...f.channels, email: { async send() { chamadas += 1; throw new Error('x') } } }
    let agora = AGORA
    for (const espera of [1, 5, 15]) {
      expect(await processDueNotifications({ now: agora, channels })).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 1 })
      agora = addMinutes(agora, espera)
    }
    // 4ª falha em +21 min: a 5ª tentativa seria em +81 min
    expect(chamadas).toBe(3)
    expect(await processDueNotifications({ now: agora, channels })).toEqual({ sent: 0, skipped: 0, failed: 0, retried: 1 })
    const apos = await reload(n.id)
    expect(apos.scheduledFor.getTime()).toBe(previsto.getTime())
    expect(apos.nextAttemptAt?.getTime()).toBe(addMinutes(agora, 60).getTime())
    expect(chamadas).toBe(4)
    expect(await processDueNotifications({ now: addMinutes(agora, 60), channels })).toEqual({ sent: 0, skipped: 1, failed: 0, retried: 0 })
    expect(chamadas).toBe(4)
    expect(await reload(n.id)).toMatchObject({ status: 'SKIPPED' })
    expect(['late', 'past']).toContain((await reload(n.id)).skipReason)
  })

  test('push vai para os aparelhos do vínculo do membro', async () => {
    const c = await cena()
    await prisma.device.create({ data: { businessId: c.business.id, membershipId: c.vinculo.id, platform: 'ANDROID', pushToken: 'ExponentPushToken[membro]', lastSeenAt: AGORA } })
    await prisma.device.create({ data: { businessId: c.business.id, customerId: c.cliente.id, platform: 'ANDROID', pushToken: 'ExponentPushToken[cliente]', lastSeenAt: AGORA } })
    const n = await aviso(c, { kind: 'STAFF_NEW_APPOINTMENT', channel: 'PUSH', membership: true })
    const f = fake()
    await processDueNotifications({ now: AGORA, channels: f.channels })
    expect(f.pushes.map((p) => p.tokens)).toEqual([['ExponentPushToken[membro]']])
    expect((await reload(n.id)).status).toBe('SENT')
  })

  test('push sem canal configurado: FAILED not_configured sem nova tentativa', async () => {
    const c = await cena()
    await prisma.device.create({ data: { businessId: c.business.id, customerId: c.cliente.id, platform: 'IOS', pushToken: 'ExponentPushToken[a]', lastSeenAt: AGORA } })
    const n = await aviso(c, { channel: 'PUSH' })
    const f = fake()
    expect(await processDueNotifications({ now: AGORA, channels: { ...f.channels, push: null } })).toEqual({ sent: 0, skipped: 0, failed: 1, retried: 0 })
    expect(await reload(n.id)).toMatchObject({ status: 'FAILED', lastError: 'not_configured' })
  })

  test('falha ao apagar tokens inválidos não reagenda um push que já saiu; o erro é registrado só pelo nome', async () => {
    const c = await cena()
    await prisma.device.createMany({
      data: ['bom', 'ruim'].map((t) => ({ businessId: c.business.id, customerId: c.cliente.id, platform: 'IOS' as const, pushToken: `ExponentPushToken[${t}]`, lastSeenAt: AGORA })),
    })
    const n = await aviso(c, { channel: 'PUSH' })
    const f = fake()
    f.invalid = ['ExponentPushToken[ruim]']
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const apagar = vi.spyOn(prisma.device, 'deleteMany').mockRejectedValue(new TypeError('falha com ExponentPushToken[ruim]'))
    try {
      expect(await processDueNotifications({ now: AGORA, channels: f.channels })).toEqual({ sent: 1, skipped: 0, failed: 0, retried: 0 })
    } finally {
      apagar.mockRestore()
      const texto = JSON.stringify(log.mock.calls)
      log.mockRestore()
      expect(texto).toContain('TypeError')
      expect(texto).not.toContain('ExponentPushToken')
    }
    expect(await reload(n.id)).toMatchObject({ status: 'SENT', attempts: 0 })
    expect(f.pushes).toHaveLength(1)
  })

  test('conta que sumiu entre a reserva e a recarga: SKIPPED gone, contado como descartado', async () => {
    const c = await cena()
    const n = await aviso(c)
    const f = fake()
    const espiao = vi.spyOn(prisma.business, 'findFirst').mockResolvedValueOnce(null)
    try {
      expect(await processDueNotifications({ now: AGORA, channels: f.channels })).toEqual({ sent: 0, skipped: 1, failed: 0, retried: 0 })
    } finally {
      espiao.mockRestore()
    }
    expect(await reload(n.id)).toMatchObject({ status: 'SKIPPED', skipReason: 'gone' })
    expect(f.emails).toEqual([])
  })

  test('respeita o limite por rodada', async () => {
    const c = await cena()
    for (let i = 0; i < 5; i += 1) await aviso(c, { key: `k${i}`, scheduledFor: addMinutes(AGORA, -i - 1) })
    const f = fake()
    expect((await processDueNotifications({ now: AGORA, limit: 2, channels: f.channels })).sent).toBe(2)
    expect((await processDueNotifications({ now: AGORA, channels: f.channels })).sent).toBe(3)
  })
})

describe('seed de demonstração', () => {
  const ENV: SeedEnv = {
    SEED_ADMIN_EMAIL: 'admin@agendaflui.localhost',
    SEED_ADMIN_PASSWORD: 'senha-do-admin-demo',
    SEED_USER_PASSWORD: 'senha-dos-usuarios-demo',
    SEED_MULTI_EMAIL: 'multi@agendaflui.localhost',
  }
  // Quarta-feira, 12:00 em São Paulo.
  const NOW = new Date('2026-11-18T15:00:00Z')

  test('os avisos de agendamentos passados viram SKIPPED e nenhum e-mail sai para eles', async () => {
    await seed(prisma, ENV, { now: NOW })
    const pendentes = await prisma.notification.count({ where: { status: 'PENDING' } })
    expect(pendentes).toBeGreaterThan(40)
    const f = fake()
    let total = { sent: 0, skipped: 0, failed: 0, retried: 0 }
    for (;;) {
      const r = await processDueNotifications({ now: NOW, limit: 50, channels: f.channels })
      if (r.sent + r.skipped + r.failed + r.retried === 0) break
      total = { sent: total.sent + r.sent, skipped: total.skipped + r.skipped, failed: total.failed + r.failed, retried: total.retried + r.retried }
    }
    expect(total.failed).toBe(0)
    expect(total.retried).toBe(0)
    expect(await prisma.notification.count({ where: { status: 'PENDING', scheduledFor: { lte: NOW } } })).toBe(0)

    const avisos = await prisma.notification.findMany({ include: { appointment: true } })
    const isentos: NotificationKind[] = ['APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_CANCELED']
    const passados = avisos.filter((a) => a.appointment && a.appointment.endsAt.getTime() <= NOW.getTime() && !isentos.includes(a.kind) && a.scheduledFor.getTime() <= NOW.getTime())
    expect(passados.length).toBeGreaterThan(0)
    for (const a of passados) {
      expect(a.status).toBe('SKIPPED')
      // Quem não tem e-mail nem aparelho é descartado antes, pelo destinatário; o resto, por ser passado.
      expect(['past', 'stale', 'no_email', 'no_device']).toContain(a.skipReason)
    }
    expect(passados.filter((a) => a.skipReason === 'past' || a.skipReason === 'stale').length).toBeGreaterThan(0)
    const enviados = avisos.filter((a) => a.status === 'SENT')
    expect(enviados.length).toBeGreaterThan(0)
    for (const a of enviados.filter((x) => !isentos.includes(x.kind))) {
      expect(a.appointment!.endsAt.getTime()).toBeGreaterThan(NOW.getTime())
    }
    expect(f.emails).toHaveLength(enviados.filter((a) => a.channel === 'EMAIL').length)
    for (const e of f.emails) {
      expect(e.subject).not.toContain('undefined')
      expect(e.text).not.toContain('undefined')
    }
    expect(total.skipped + total.sent).toBeGreaterThan(40)
  })

  test('backlog de mais de 24 h: nenhum concluído nem cancelado sai, e nada de agendamento já terminado', async () => {
    await seed(prisma, ENV, { now: NOW })
    const f = fake()
    const depois = addMinutes(NOW, 25 * 60)
    for (;;) {
      const r = await processDueNotifications({ now: depois, limit: 50, channels: f.channels })
      if (r.sent + r.skipped + r.failed + r.retried === 0) break
    }
    const enviados = await prisma.notification.findMany({ where: { status: 'SENT' }, include: { appointment: true } })
    for (const a of enviados) {
      expect(['APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_CANCELED']).not.toContain(a.kind)
      expect(a.appointment!.endsAt.getTime()).toBeGreaterThan(depois.getTime())
    }
    const tardios = await prisma.notification.findMany({ where: { kind: { in: ['APPOINTMENT_COMPLETED', 'APPOINTMENT_CANCELED', 'STAFF_APPOINTMENT_CANCELED'] }, status: 'SKIPPED' } })
    expect(tardios.some((a) => a.skipReason === 'late')).toBe(true)
  })
})

