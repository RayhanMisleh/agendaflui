import { PrismaPg } from '@prisma/adapter-pg'
import { env, runtimeDatabaseUrl } from '@/server/env'
import { pgConfig } from './connection'
import { PrismaClient } from './generated/client'

const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient }

function criarCliente(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pgConfig(runtimeDatabaseUrl(env))) })
}

export const prisma: PrismaClient = globalParaPrisma.prisma ?? criarCliente()

if (env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma
