import { PrismaPg } from '@prisma/adapter-pg'
import { env } from '@/server/env'
import { PrismaClient } from './generated/client'

const globalParaPrisma = globalThis as unknown as { prisma?: PrismaClient }

function criarCliente(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({
      connectionString: env.DATABASE_URL,
      // A sessão é sempre UTC, qualquer que seja o padrão do servidor ou do banco.
      options: '-c timezone=UTC',
    }) })
}

export const prisma: PrismaClient = globalParaPrisma.prisma ?? criarCliente()

if (env.NODE_ENV !== 'production') globalParaPrisma.prisma = prisma
