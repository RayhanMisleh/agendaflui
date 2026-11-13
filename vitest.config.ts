import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/unit/**/*.test.ts?(x)', 'tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '_legacy/**', '.local/**'],
  },
})
