import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    // Os testes de integração compartilham um único banco e o resetDb esvazia tudo.
    fileParallelism: false,
    globalSetup: ['./tests/setup/global-db.ts'],
    include: ['tests/unit/**/*.test.ts?(x)', 'tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '_legacy/**', '.local/**'],
  },
})
