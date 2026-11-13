import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // generate não conecta; migrate deploy lê a URL real do ambiente.
    url: process.env.DATABASE_URL ?? 'postgres://agendaflui:agendaflui@localhost:54329/agendaflui',
  },
})
