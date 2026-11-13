import { defineConfig } from 'prisma/config'

// O Prisma 7 não carrega o .env sozinho.
try {
  process.loadEnvFile()
} catch {
  // Sem .env: segue com as variáveis do ambiente.
}

const url = process.env.DATABASE_URL
const comandosQueConectam = ['migrate', 'db', 'studio']

if (!url && process.argv.some((arg) => comandosQueConectam.includes(arg))) {
  throw new Error(
    'DATABASE_URL não está definida. Copie .env.example para .env (ou defina a variável) e tente de novo.',
  )
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // prisma generate não conecta, então roda sem URL (postinstall em clone limpo).
  ...(url ? { datasource: { url } } : {}),
})
