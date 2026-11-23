import type { Business, Customer, Professional, Service } from '@/server/db/generated/client'
import { prisma } from '@/server/db/client'
import { hashPassword } from '@/server/auth/password'
import { addDays, todayIn, WEEKDAYS } from '@/server/time'
import { customerToken } from './api'
import { makeBusiness, makeCustomer, makeMembership, makeProfessional, makeService, makeUser, makeWorkingHours } from './factories'

export const SENHA = 'senha-muito-segura-1'

export type Cena = {
  business: Business
  banho: Service
  clube: Service
  inativo: Service
  ana: Professional
  /** Cliente comum, com senha. */
  cliente: Customer
  outro: Customer
  socio: Customer
  tokenCliente: string
  tokenOutro: string
  tokenSocio: string
  /** Data local daqui a `n` dias no fuso da conta. */
  dia: (n: number) => string
}

/**
 * Conta com um profissional (Ana, comissão e vínculo preenchidos para provar que não vazam), expediente de 08:00 a 18:00
 * todos os dias, três serviços (um do clube, um inativo) e três clientes com token.
 */
export async function montarCena(o: { timeZone?: string } = {}): Promise<Cena> {
  const business = await makeBusiness({
    ...(o.timeZone ? { timezone: o.timeZone } : {}),
    internalNotes: 'nota-interna-secreta',
    document: '12.345.678/0001-90',
    email: 'contato-interno@exemplo.test',
    phone: '5511999990000',
  })
  const banho = await makeService(business.id, { name: 'Banho', durationMin: 60, priceCents: 8000, displayOrder: 1 })
  const clube = await makeService(business.id, { name: 'Corte do clube', durationMin: 30, priceCents: 3000, clubOnly: true, displayOrder: 2 })
  const inativo = await makeService(business.id, { name: 'Serviço parado', active: false, displayOrder: 3 })
  const user = await makeUser()
  const membership = await makeMembership(business.id, user.id, 'PROFESSIONAL')
  const ana = await makeProfessional(business.id, {
    name: 'Ana',
    bio: 'Banhos e cortes',
    commissionBps: 3000,
    membershipId: membership.id,
    serviceIds: [banho.id, clube.id, inativo.id],
  })
  for (const weekday of WEEKDAYS) await makeWorkingHours(business.id, ana.id, weekday, [{ startMin: 480, endMin: 1080 }])
  const passwordHash = await hashPassword(SENHA)
  const cliente = await makeCustomer(business.id, { name: 'Cliente Um', email: 'um@exemplo.test', passwordHash, origin: 'APP', emailVerifiedAt: new Date() })
  const outro = await makeCustomer(business.id, { name: 'Cliente Dois', email: 'dois@exemplo.test', passwordHash, origin: 'APP', emailVerifiedAt: new Date() })
  const socio = await makeCustomer(business.id, { name: 'Cliente Sócio', email: 'socio@exemplo.test', passwordHash, origin: 'APP', isClubMember: true })
  const timeZone = business.timezone
  return {
    business,
    banho,
    clube,
    inativo,
    ana,
    cliente,
    outro,
    socio,
    tokenCliente: await customerToken(business.id, cliente.id),
    tokenOutro: await customerToken(business.id, outro.id),
    tokenSocio: await customerToken(business.id, socio.id),
    dia: (n) => addDays(todayIn(timeZone, new Date()), n),
  }
}

/** Quantos agendamentos há na conta. */
export const totalAgendamentos = (businessId: string): Promise<number> => prisma.appointment.count({ where: { businessId } })

/** Caminhos de todas as chaves de um JSON (`a`, `a.b`, `lista[].c`), sem descer em `brand.tokens` (registro de variáveis CSS). */
export function chavesDe(valor: unknown, base = ''): string[] {
  if (Array.isArray(valor)) return valor.flatMap((v) => chavesDe(v, `${base}[]`))
  if (typeof valor !== 'object' || valor === null) return []
  return Object.entries(valor).flatMap(([k, v]) => {
    const p = base === '' ? k : `${base}.${k}`
    return p === 'brand.tokens' ? [p] : [p, ...chavesDe(v, p)]
  })
}
